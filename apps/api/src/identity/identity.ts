import { Body, Controller, Get, HttpCode, Injectable, Post, Put, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import {
  registerSchema, loginSchema, tokenSchema, forgotSchema, resetSchema, studentProfileSchema,
  TERMS_VERSION, PRIVACY_VERSION, type MeUser, type Role,
} from '@cogniverse/contracts';
import { AppError, Db, Tx, config, parse, rateLimit, randomToken, sha256 } from '../common/infra';
import { assignReferralCode } from '../growth/referral';
import { AuthUser, CurrentUser, Public, Roles, signAccess, revokeSid, ACCESS_TTL_SECONDS } from '../common/auth';
import { Notifications } from '../notification/notification';

const STUDENT_REFRESH_DAYS = 30;
const STAFF_REFRESH_HOURS = 8;

@Injectable()
export class IdentityService {
  constructor(private db: Db, readonly notif: Notifications) {}

  async rolesOf(userId: string, c?: Tx): Promise<Role[]> {
    const r = await this.db.query('SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1', [userId], c);
    return r.rows.map((x) => x.code);
  }

  async me(userId: string): Promise<MeUser & { studentProfile: any }> {
    const u = await this.db.one('SELECT id, email, full_name, email_verified_at FROM users WHERE id = $1', [userId]);
    if (!u) throw new AppError('UNAUTHENTICATED', 'Silakan masuk terlebih dahulu.');
    const p = await this.db.one('SELECT * FROM student_profiles WHERE user_id = $1', [userId]);
    const t = await this.db.one('SELECT 1 AS ok FROM student_targets WHERE user_id = $1 AND priority = 1', [userId]);
    return {
      id: u.id, email: u.email, fullName: u.full_name, roles: await this.rolesOf(userId),
      emailVerified: !!u.email_verified_at, profileComplete: !!p?.onboarding_completed_at, hasTarget: !!t,
      studentProfile: p ? {
        studentStatus: p.student_status, schoolName: p.school_name, graduationYear: p.graduation_year,
        province: p.province, phone: p.phone, completedAt: p.onboarding_completed_at, dailyStudyMinutes: p.daily_study_minutes,
      } : null,
    };
  }

  /** Membuat auth_session baru + cookie (TDD 5.2). */
  async issueSession(res: Response, req: Request, userId: string, roles: Role[], familyId = crypto.randomUUID(), c?: Tx) {
    const refresh = randomToken();
    const isStudent = roles.length === 1 && roles[0] === 'STUDENT';
    const ttlMs = isStudent ? STUDENT_REFRESH_DAYS * 86400e3 : STAFF_REFRESH_HOURS * 3600e3;
    const s = await this.db.one(
      `INSERT INTO auth_sessions (user_id, family_id, refresh_token_hash, expires_at, last_used_at, user_agent, ip)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4), now(), $5, $6) RETURNING id`,
      [userId, familyId, sha256(refresh), ttlMs / 1000, req.headers['user-agent'] ?? null, normalizeIp(req.ip)], c);
    const access = await signAccess({ id: userId, roles, sid: s!.id });
    setAuthCookies(res, access, refresh, ttlMs);
    return s!.id as string;
  }

  async createToken(c: Tx, userId: string, purpose: string, ttlSeconds: number) {
    const token = randomToken();
    await c.query(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [userId, purpose, sha256(token), ttlSeconds]);
    return token;
  }

  async sendVerification(c: Tx, userId: string, email: string, name: string) {
    const token = await this.createToken(c, userId, 'EMAIL_VERIFICATION', 24 * 3600);
    await this.notif.enqueue(c, {
      userId, recipient: email, template: 'EMAIL_VERIFICATION', dedupeKey: `EMAIL_VERIFICATION:${userId}:${Date.now()}`,
      payload: { name, link: `${config.webOrigin}/verifikasi-email?token=${token}` },
    });
  }

  async consumeToken(c: Tx, token: string, purpose: string) {
    const t = await this.db.one(
      `UPDATE auth_tokens SET used_at = now()
        WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`, [sha256(token), purpose], c);
    if (!t) throw new AppError('TOKEN_EXPIRED_OR_USED', 'Tautan ini sudah tidak berlaku. Minta tautan baru.');
    return t.user_id as string;
  }
}

function normalizeIp(ip?: string) {
  if (!ip) return null;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function setAuthCookies(res: Response, access: string, refresh: string, refreshMs: number) {
  const base = { httpOnly: true, sameSite: 'lax' as const, secure: config.isProd };
  res.cookie('cv_at', access, { ...base, path: '/api', maxAge: ACCESS_TTL_SECONDS * 1000 });
  res.cookie('cv_rt', refresh, { ...base, path: '/api/v1/auth', maxAge: refreshMs });
}
function clearAuthCookies(res: Response) {
  res.clearCookie('cv_at', { path: '/api' });
  res.clearCookie('cv_rt', { path: '/api/v1/auth' });
}

@Controller('auth')
export class AuthController {
  constructor(private db: Db, private ids: IdentityService, private notif: Notifications) {}

  /** EP-AUTH-01 */
  @Public() @Post('register')
  async register(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    rateLimit(`register:${req.ip}`, 5, 3600e3);
    const input = parse(registerSchema, body);
    const hash = await argon2.hash(input.password, { type: argon2.argon2id });
    const userId = await this.db.tx(async (c) => {
      const exists = await this.db.one('SELECT 1 FROM users WHERE email = $1', [input.email], c);
      if (exists) throw new AppError('EMAIL_ALREADY_REGISTERED', 'Email ini sudah terdaftar. Silakan masuk atau atur ulang kata sandi.');
      const u = await this.db.one(
        `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id`,
        [input.email, hash, input.fullName], c);
      await c.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'STUDENT'`, [u!.id]);
      // FR-REF-01/02: kode milik akun baru, lalu catat referral bila kode valid (kode tidak valid diabaikan, UJ-01 A3)
      await assignReferralCode(c, u!.id);
      if (input.referralCode) {
        await c.query(
          `INSERT INTO referrals (referrer_id, referred_id, code_used)
           SELECT id, $1, $2 FROM users WHERE referral_code = $2 AND id <> $1
           ON CONFLICT (referred_id) DO NOTHING`, [u!.id, input.referralCode]);
      }
      await c.query(
        `INSERT INTO user_consents (user_id, document_type, document_version, ip) VALUES ($1,'TERMS',$2,$4),($1,'PRIVACY',$3,$4)`,
        [u!.id, TERMS_VERSION, PRIVACY_VERSION, normalizeIp(req.ip)]);
      await this.ids.sendVerification(c, u!.id, input.email, input.fullName);
      await this.ids.issueSession(res, req, u!.id, ['STUDENT'], undefined, c);
      return u!.id as string;
    });
    res.status(201);
    return { user: await this.ids.me(userId) };
  }

  /** EP-AUTH-02 */
  @Public() @Post('verify-email') @HttpCode(200)
  async verify(@Body() body: unknown) {
    const { token } = parse(tokenSchema, body);
    await this.db.tx(async (c) => {
      const userId = await this.ids.consumeToken(c, token, 'EMAIL_VERIFICATION');
      await c.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [userId]);
    });
    return { verified: true };
  }

  /** EP-AUTH-03 */
  @Post('verify-email/resend') @HttpCode(204)
  async resend(@CurrentUser() me: AuthUser) {
    rateLimit(`resend:${me.id}`, 1, 60e3);
    rateLimit(`resend-day:${me.id}`, 5, 86400e3);
    await this.db.tx(async (c) => {
      const u = await this.db.one('SELECT email, full_name, email_verified_at FROM users WHERE id = $1', [me.id], c);
      if (u && !u.email_verified_at) await this.ids.sendVerification(c, me.id, u.email, u.full_name);
    });
  }

  /** EP-AUTH-04 */
  @Public() @Post('login') @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    rateLimit(`login:${req.ip}`, 10, 60e3);
    const input = parse(loginSchema, body);
    const invalid = () => new AppError('INVALID_CREDENTIALS', 'Email atau kata sandi salah.');
    const u = await this.db.one('SELECT * FROM users WHERE email = $1', [input.email]);
    if (!u || !u.password_hash) throw invalid();
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 60000);
      throw new AppError('RATE_LIMITED', `Terlalu banyak percobaan masuk. Coba lagi dalam ${mins} menit.`);
    }
    const ok = await argon2.verify(u.password_hash, input.password).catch(() => false);
    if (!ok) {
      // FR-AUTH-09: jeda meningkat setelah 5 kegagalan
      await this.db.query(
        `UPDATE users SET failed_login_count = failed_login_count + 1,
           locked_until = CASE WHEN failed_login_count + 1 >= 5
             THEN now() + make_interval(mins => LEAST(60, power(2, failed_login_count + 1 - 5)::int)) END
         WHERE id = $1`, [u.id]);
      throw invalid();
    }
    if (u.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED', 'Akun kamu sedang dinonaktifkan. Hubungi bantuan Cogniverse.');
    if (u.status !== 'ACTIVE') throw invalid();
    await this.db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
    const roles = await this.ids.rolesOf(u.id);
    await this.ids.issueSession(res, req, u.id, roles);
    return { user: await this.ids.me(u.id) };
  }

  /** EP-AUTH-05: rotasi refresh token dengan deteksi pemakaian ulang. */
  @Public() @Post('refresh') @HttpCode(204)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.cv_rt;
    const fail = () => { clearAuthCookies(res); return new AppError('UNAUTHENTICATED', 'Sesi berakhir. Silakan masuk kembali.'); };
    if (!token) throw fail();
    await this.db.tx(async (c) => {
      const s = await this.db.one('SELECT * FROM auth_sessions WHERE refresh_token_hash = $1 FOR UPDATE', [sha256(token)], c);
      if (!s) throw fail();
      if (s.revoked_at) {
        if (s.revoked_reason === 'ROTATED') {
          const fam = await c.query(
            `UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'REUSE_DETECTED'
              WHERE family_id = $1 AND revoked_at IS NULL RETURNING id`, [s.family_id]);
          fam.rows.forEach((r) => revokeSid(r.id));
        }
        throw fail();
      }
      if (new Date(s.expires_at) <= new Date()) throw fail();
      const u = await this.db.one('SELECT status FROM users WHERE id = $1', [s.user_id], c);
      if (u?.status !== 'ACTIVE') throw fail();
      const roles = await this.ids.rolesOf(s.user_id, c);
      const newSid = await this.ids.issueSession(res, req, s.user_id, roles, s.family_id, c);
      await c.query(`UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'ROTATED', replaced_by_id = $2 WHERE id = $1`, [s.id, newSid]);
      revokeSid(s.id);
    });
  }

  /** EP-AUTH-06 */
  @Public() @Post('logout') @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.cv_rt;
    if (token) {
      const r = await this.db.query(
        `UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'LOGOUT'
          WHERE refresh_token_hash = $1 AND revoked_at IS NULL RETURNING id`, [sha256(token)]);
      r.rows.forEach((x) => revokeSid(x.id));
    }
    const u = (req as any).user as AuthUser | undefined;
    if (u) revokeSid(u.sid);
    clearAuthCookies(res);
  }

  /** EP-AUTH-07: selalu 204 agar tidak mengungkap keberadaan email. */
  @Public() @Post('password/forgot') @HttpCode(204)
  async forgot(@Body() body: unknown, @Req() req: Request) {
    const { email } = parse(forgotSchema, body);
    rateLimit(`forgot-ip:${req.ip}`, 10, 3600e3);
    try { rateLimit(`forgot:${email}`, 1, 60e3); } catch { return; }
    await this.db.tx(async (c) => {
      const u = await this.db.one(`SELECT id, full_name FROM users WHERE email = $1 AND status = 'ACTIVE'`, [email], c);
      if (!u) return;
      const token = await this.ids.createToken(c, u.id, 'PASSWORD_RESET', 3600);
      await this.notif.enqueue(c, {
        userId: u.id, recipient: email, template: 'PASSWORD_RESET', dedupeKey: `PASSWORD_RESET:${u.id}:${Date.now()}`,
        payload: { name: u.full_name, link: `${config.webOrigin}/atur-ulang-kata-sandi?token=${token}` },
      });
    });
  }

  /** EP-AUTH-08: mencabut semua sesi lain. */
  @Public() @Post('password/reset') @HttpCode(204)
  async reset(@Body() body: unknown) {
    const input = parse(resetSchema, body);
    const hash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
    await this.db.tx(async (c) => {
      const userId = await this.ids.consumeToken(c, input.token, 'PASSWORD_RESET');
      await c.query('UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL WHERE id = $1', [userId, hash]);
      const r = await c.query(
        `UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'PASSWORD_RESET' WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`, [userId]);
      r.rows.forEach((x) => revokeSid(x.id));
    });
  }
}

@Controller('users')
export class UsersController {
  constructor(private db: Db, private ids: IdentityService) {}

  /** EP-USR-01 */
  @Get('me')
  async me(@CurrentUser() me: AuthUser) {
    const user = await this.ids.me(me.id);
    const { studentProfile, ...rest } = user;
    return { user: rest, studentProfile, pendingConsents: [] };
  }

  /** EP-USR-03 (FR-PROF-01/03) */
  @Put('me/student-profile') @Roles('STUDENT')
  async profile(@CurrentUser() me: AuthUser, @Body() body: unknown) {
    const p = parse(studentProfileSchema, body);
    await this.db.query(
      `INSERT INTO student_profiles (user_id, student_status, school_name, graduation_year, province, phone, onboarding_completed_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (user_id) DO UPDATE SET student_status = EXCLUDED.student_status, school_name = EXCLUDED.school_name,
         graduation_year = EXCLUDED.graduation_year, province = EXCLUDED.province, phone = EXCLUDED.phone,
         onboarding_completed_at = COALESCE(student_profiles.onboarding_completed_at, now())`,
      [me.id, p.studentStatus, p.schoolName, p.graduationYear, p.province, p.phone || null]);
    return { studentProfile: (await this.ids.me(me.id)).studentProfile };
  }
}
