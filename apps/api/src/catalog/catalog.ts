import { Controller, Get, Injectable, Param, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Db, iso, notFound, rateLimit } from '../common/infra';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth';
import { Commerce, dateOnly } from '../growth/commerce';

/** Ringkasan exam periode untuk katalog dan halaman detail (v3.0: satu tipe, tanpa harga per exam). */
const EXAM_SUMMARY_SQL = `
  SELECT e.id, e.slug, e.title, e.description, e.exam_type, e.delivery_mode, e.timing_mode, e.status, e.series_id,
         sr.name AS series_name, sr.exam_date, sr.status AS series_status,
         e.duration_minutes, e.max_attempts, e.access_duration_days, e.available_from, e.available_until,
         (SELECT count(*) FROM exam_questions q WHERE q.exam_id = e.id)::int AS total_questions,
         (SELECT count(*) FROM exam_sections s WHERE s.exam_id = e.id)::int AS section_count,
         CASE WHEN e.timing_mode = 'TOTAL' THEN e.duration_minutes * 60
              ELSE (SELECT COALESCE(sum(s.duration_minutes), 0) FROM exam_sections s WHERE s.exam_id = e.id) * 60 END AS total_seconds,
         CASE WHEN now() < e.available_from THEN 'UPCOMING' WHEN now() > e.available_until THEN 'CLOSED' ELSE 'OPEN' END AS period_state,
         row_number() OVER (PARTITION BY e.series_id ORDER BY e.available_from, e.created_at)::int AS period_number
    FROM exams e JOIN exam_series sr ON sr.id = e.series_id`;

function examDto(e: any) {
  return {
    id: e.id, slug: e.slug, title: e.title, description: e.description, examType: e.exam_type, reportTier: 'COMPLETE',
    series: { id: e.series_id, name: e.series_name, examDate: e.exam_date ? dateOnly(e.exam_date) : null },
    periodNumber: e.period_number, periodState: e.period_state,
    deliveryMode: e.delivery_mode, timingMode: e.timing_mode, status: e.status,
    totalQuestions: e.total_questions, sectionCount: e.section_count, totalDurationSeconds: Number(e.total_seconds ?? 0),
    maxAttempts: e.max_attempts, accessDurationDays: e.access_duration_days,
    availableFrom: iso(e.available_from), availableUntil: iso(e.available_until),
  };
}

@Injectable()
export class EntitlementService {
  constructor(private db: Db) {}

  /** Status turunan untuk "Asesmen Saya" (EP-ENT-01). */
  async listForUser(userId: string) {
    const r = await this.db.query(
      `SELECT en.*, e.title, e.slug, e.exam_type, e.delivery_mode, e.timing_mode,
              a.id AS active_attempt_id, a.expires_at AS active_expires_at,
              (SELECT min(s.deadline_at) FROM attempt_sections s WHERE s.attempt_id = a.id AND s.status = 'ACTIVE') AS active_section_deadline,
              (SELECT x.id FROM exam_attempts x WHERE x.entitlement_id = en.id AND x.status IN ('SUBMITTED','SCORED')
                ORDER BY x.submitted_at DESC LIMIT 1) AS last_attempt_id,
              now() AS server_now
         FROM entitlements en
         JOIN exams e ON e.id = en.exam_id
         LEFT JOIN exam_attempts a ON a.entitlement_id = en.id AND a.status = 'IN_PROGRESS'
        WHERE en.user_id = $1
        ORDER BY en.created_at DESC`, [userId]);
    return r.rows.map((x) => {
      const remaining = x.max_attempts - x.attempts_used;
      let state: string;
      if (x.status === 'REVOKED') state = 'REVOKED';
      else if (x.active_attempt_id) state = 'IN_PROGRESS';
      else if (remaining <= 0) state = 'COMPLETED';
      else if (new Date(x.valid_until) < new Date(x.server_now)) state = 'EXPIRED';
      else state = 'READY';
      const primaryAction = state === 'IN_PROGRESS' ? 'RESUME' : state === 'READY' ? 'OPEN_INSTRUCTIONS'
        : x.last_attempt_id ? 'VIEW_RESULT' : null;
      return {
        id: x.id, source: x.source, state, attemptsRemaining: Math.max(0, remaining), maxAttempts: x.max_attempts,
        validUntil: iso(x.valid_until), primaryAction, lastAttemptId: x.last_attempt_id,
        activeAttempt: x.active_attempt_id ? { id: x.active_attempt_id, expiresAt: iso(x.active_expires_at), sectionDeadlineAt: iso(x.active_section_deadline) } : null,
        exam: { id: x.exam_id, slug: x.slug, title: x.title, examType: x.exam_type, deliveryMode: x.delivery_mode, timingMode: x.timing_mode },
      };
    });
  }
}

@Controller()
export class CatalogController {
  constructor(private db: Db, private ents: EntitlementService, private commerce: Commerce) {}

  /** Status akses per exam untuk siswa yang masuk (EP-EXM-01). */
  private async accessFor(userId: string) {
    const [mine, acc] = await Promise.all([this.ents.listForUser(userId), this.commerce.access(userId)]);
    return (e: any) => {
      const own = mine.find((x) => x.exam.id === e.id && x.state !== 'REVOKED');
      if (own) return { kind: 'ENTITLED', state: own.state, entitlementId: own.id, lastAttemptId: own.lastAttemptId, attemptsRemaining: own.attemptsRemaining };
      if (acc.seasonPass && acc.seasonPass.seriesId === e.series_id && new Date(e.available_from) <= new Date(acc.seasonPass.validUntil!)) {
        return { kind: 'SEASON_PASS', validUntil: acc.seasonPass.validUntil };
      }
      const credits = acc.credits.grants.filter((g) => g.total - g.used > 0).reduce((n, g) => n + g.total - g.used, 0);
      return credits > 0 ? { kind: 'CREDIT_AVAILABLE', credits } : { kind: 'NONE' };
    };
  }

  /** EP-EXM-01 (v3.0): Full Try Out periode musim aktif. */
  @Public() @Get('catalog/products')
  async list(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query('state') state?: string) {
    rateLimit(`catalog:${req.ip}`, 120, 60e3);
    const user = (req as any).user as AuthUser | undefined;
    res.setHeader('Cache-Control', user ? 'private, no-store' : 'public, max-age=60');
    const season = await this.commerce.activeSeason();
    if (!season) return { season: null, data: [] };
    const r = await this.db.query(
      `SELECT * FROM (${EXAM_SUMMARY_SQL} WHERE e.status = 'PUBLISHED' AND e.series_id = $1) x
        WHERE ($2::text IS NULL OR x.period_state = $2) ORDER BY x.available_from, x.title`, [season.id, state || null]);
    const access = user?.roles.includes('STUDENT') ? await this.accessFor(user.id) : null;
    return {
      season: { id: season.id, name: season.name, examDate: season.exam_date ? dateOnly(season.exam_date) : null, lifetimeEndsAt: iso(season.lifetime_ends_at) },
      data: r.rows.map((e) => ({ ...examDto(e), access: access ? access(e) : null })),
    };
  }

  /** EP-EXM-02 (v3.0): detail periode berdasarkan slug exam. */
  @Public() @Get('catalog/products/:slug')
  async detail(@Param('slug') slug: string, @Req() req: Request) {
    const e = await this.db.one(`${EXAM_SUMMARY_SQL} WHERE e.slug = $1 AND e.status IN ('PUBLISHED','UNPUBLISHED')`, [slug]);
    if (!e) throw notFound();
    const sections = await this.db.query(
      `SELECT s.name, s.position, s.duration_minutes, count(q.id)::int AS question_count
         FROM exam_sections s LEFT JOIN exam_questions q ON q.exam_section_id = s.id
        WHERE s.exam_id = $1 GROUP BY s.id ORDER BY s.position`, [e.id]);
    const user = (req as any).user as AuthUser | undefined;
    const access = user?.roles.includes('STUDENT') ? (await this.accessFor(user.id))(e) : null;
    return {
      exam: { ...examDto(e), sections: sections.rows.map((s) => ({ name: s.name, position: s.position, questionCount: s.question_count, durationMinutes: s.duration_minutes })) },
      access,
    };
  }

  /** EP-ENT-01 */
  @Roles('STUDENT') @Get('users/me/entitlements')
  async mine(@CurrentUser() me: AuthUser) {
    return { data: await this.ents.listForUser(me.id), access: await this.commerce.access(me.id) };
  }
}
