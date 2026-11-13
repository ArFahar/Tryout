import { Controller, Get, Injectable, Param, Req } from '@nestjs/common';
import { Request } from 'express';
import crypto from 'node:crypto';
import { Db, Tx, config, iso, rateLimit } from '../common/infra';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth';
import { Settings } from '../common/settings';
import { Notifications } from '../notification/notification';

/** Alfabet tanpa karakter yang mudah tertukar (0/O, 1/I/L) — TDD 6.7.3. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const newCode = () => Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');

/** FR-REF-01: memastikan akun memiliki kode referral (dibuat saat registrasi; akun lama diisi saat pertama dibutuhkan). */
export async function assignReferralCode(c: Tx, userId: string): Promise<string> {
  const cur = await c.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
  if (cur.rows[0]?.referral_code) return cur.rows[0].referral_code;
  for (let i = 0; i < 8; i++) {
    const code = newCode();
    await c.query('SAVEPOINT refcode');
    try {
      await c.query('UPDATE users SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL', [userId, code]);
      await c.query('RELEASE SAVEPOINT refcode');
      const r = await c.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
      return r.rows[0].referral_code;
    } catch (e: any) {
      await c.query('ROLLBACK TO SAVEPOINT refcode');
      if (e?.code !== '23505') throw e; // bentrok unik -> coba kode lain
    }
  }
  throw new Error('Gagal membuat kode referral unik');
}

@Injectable()
export class ReferralService {
  constructor(private db: Db, private settings: Settings, private notif: Notifications) {}

  /**
   * TDD 6.7.3 — dipanggil di dalam transaksi applyPaid. Referral menjadi qualified pada order PAID pertama akun yang diajak;
   * voucher diterbitkan per kelipatan threshold dengan ON CONFLICT agar aman terhadap webhook ganda.
   */
  async qualify(c: Tx, referredUserId: string, orderId: string) {
    const q = await c.query(
      `UPDATE referrals SET qualified_at = now(), qualifying_order_id = $2
        WHERE referred_id = $1 AND qualified_at IS NULL AND disqualified_at IS NULL RETURNING referrer_id`, [referredUserId, orderId]);
    if (!q.rowCount) return;
    const referrerId = q.rows[0].referrer_id;
    const threshold = Number(await this.settings.get('referral.qualify_threshold', 3, c));
    const percent = Number(await this.settings.get('referral.discount_percent', 20, c));
    const days = Number(await this.settings.get('referral.voucher_valid_days', 90, c));
    const n = (await c.query(
      'SELECT count(*)::int AS n FROM referrals WHERE referrer_id = $1 AND qualified_at IS NOT NULL AND disqualified_at IS NULL', [referrerId])).rows[0].n;
    for (let batch = 1; batch <= Math.floor(n / threshold); batch++) {
      const v = await c.query(
        `INSERT INTO vouchers (user_id, source, batch_no, percent_off, expires_at)
         VALUES ($1, 'REFERRAL', $2, $3, now() + make_interval(days => $4::int))
         ON CONFLICT (user_id, source, batch_no) DO NOTHING RETURNING id, expires_at`, [referrerId, batch, percent, days]);
      if (v.rowCount) {
        const u = (await c.query('SELECT email, full_name FROM users WHERE id = $1', [referrerId])).rows[0];
        await this.notif.enqueue(c, {
          userId: referrerId, recipient: u.email, template: 'VOUCHER_ISSUED', dedupeKey: `voucher:${v.rows[0].id}`,
          payload: { fullName: u.full_name, percentOff: percent, expiresAt: iso(v.rows[0].expires_at) },
        });
      }
    }
  }

  async summary(userId: string) {
    const code = await this.db.tx((c) => assignReferralCode(c, userId));
    const threshold = Number(await this.settings.get('referral.qualify_threshold', 3));
    const percent = Number(await this.settings.get('referral.discount_percent', 20));
    const r = await this.db.one(
      `SELECT count(*)::int AS registered,
              count(*) FILTER (WHERE qualified_at IS NOT NULL AND disqualified_at IS NULL)::int AS qualified
         FROM referrals WHERE referrer_id = $1`, [userId]);
    return {
      code, shareUrl: `${config.webOrigin}/daftar?ref=${code}`, threshold, percentOff: percent,
      registered: r!.registered, qualified: r!.qualified, nextVoucherIn: threshold - (r!.qualified % threshold),
      vouchers: await this.vouchers(userId),
    };
  }

  async vouchers(userId: string, onlyUsable = false) {
    // Voucher lewat masa berlaku ditandai EXPIRED saat dibaca (tidak perlu cron)
    await this.db.query(`UPDATE vouchers SET status = 'EXPIRED' WHERE user_id = $1 AND status = 'AVAILABLE' AND expires_at < now()`, [userId]);
    const r = await this.db.query(
      `SELECT * FROM vouchers WHERE user_id = $1 ${onlyUsable ? "AND status = 'AVAILABLE'" : ''} ORDER BY created_at DESC`, [userId]);
    return r.rows.map((v) => ({ id: v.id, percentOff: v.percent_off, status: v.status, expiresAt: iso(v.expires_at), usedAt: iso(v.used_at) }));
  }
}

@Controller()
export class ReferralController {
  constructor(private db: Db, private refs: ReferralService) {}

  /** EP-REF-01 — hanya hitungan, tanpa identitas teman (FR-REF-06). */
  @Roles('STUDENT') @Get('users/me/referral')
  summary(@CurrentUser() me: AuthUser) { return this.refs.summary(me.id); }

  /** EP-VOU-01 */
  @Roles('STUDENT') @Get('users/me/vouchers')
  async vouchers(@CurrentUser() me: AuthUser) { return { data: await this.refs.vouchers(me.id) }; }

  /** EP-REF-02 — validasi kode di formulir daftar; tanpa nama pemilik. */
  @Public() @Get('referral-codes/:code')
  async check(@Param('code') code: string, @Req() req: Request) {
    rateLimit(`refcode:${req.ip}`, 20, 60e3);
    const r = await this.db.one('SELECT 1 AS ok FROM users WHERE referral_code = $1', [String(code).trim().toUpperCase()]);
    return { valid: !!r };
  }
}
