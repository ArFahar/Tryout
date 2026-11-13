import { Body, Controller, Get, Injectable, Logger, Param, Patch, Put, Query } from '@nestjs/common';
import { guideSchema, planItemSchema, studyPrefsSchema } from '@cogniverse/contracts';
import { Db, Tx, iso, notFound, parse } from '../common/infra';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { Settings } from '../common/settings';

/**
 * Modul StudyPlanner (TDD v3.0 6.7.4, aturan `rmp-2026.11`): roadmap mingguan + plan harian yang deterministik
 * dari result terkini, klasifikasi topik, target pribadi, tanggal SNBT, dan waktu belajar harian.
 */

// ------------------------------------------------------------------ tanggal (WIB)
export const todayWib = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3);
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay(); // 6 = Sabtu
const dateStr = (d: Date | string | null) => (d == null ? null : typeof d === 'string' ? d.slice(0, 10)
  : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
const round5 = (x: number) => Math.round(x * 20) / 20;

type Topic = { topicId: string; name: string; subjectName: string; classification: string | null; accuracy: number;
  correct: number; n: number; targetAccuracy: number; reason: string; hasGuide: boolean };
type Phase = { week: number; startDate: string; endDate: string; kind: 'FOCUS' | 'CONSOLIDATE'; title: string; topics: Topic[] };
const RANK: Record<string, number> = { NEEDS_IMPROVEMENT: 0, ADEQUATE: 1, NONE: 2, STRONG: 3 };
const MAX_WEEKS = 16;

@Injectable()
export class StudyPlanner {
  private log = new Logger('StudyPlanner');
  constructor(private db: Db, private settings: Settings) {}

  async buildSafely(userId: string) {
    try { await this.build(userId); } catch (e) { this.log.error(`Roadmap gagal dibangun untuk ${userId}: ${(e as Error).message}`); }
  }

  /** Masukan roadmap dari result terkini yang analisisnya COMPLETED (BR-RMP-01). */
  private async inputs(c: Tx, userId: string) {
    const r = await this.db.one(
      `SELECT r.id, r.total_score, r.attempt_id, e.series_id, s.exam_date, an.id AS analysis_id
         FROM exam_results r JOIN exam_attempts a ON a.id = r.attempt_id JOIN exams e ON e.id = r.exam_id
         JOIN result_analyses an ON an.result_id = r.id AND an.is_current AND an.status = 'COMPLETED'
         LEFT JOIN exam_series s ON s.id = e.series_id
        WHERE r.user_id = $1 AND r.is_current AND r.publication_status = 'PUBLISHED' ORDER BY a.submitted_at DESC LIMIT 1`, [userId], c);
    if (!r) return null;
    const cfg = await this.settings.analytics(c);
    const rows = (await this.db.query(
      `SELECT t.topic_id, tp.name, sj.name AS subject_name, t.question_count AS n, t.correct_count AS correct, t.accuracy,
              EXISTS (SELECT 1 FROM topic_guides g WHERE g.topic_id = t.topic_id) AS has_guide,
              (SELECT pi.params FROM performance_insights pi WHERE pi.analysis_id = $2 AND pi.topic_id = t.topic_id
                 AND pi.dimension = 'CAPABILITY' ORDER BY pi.display_order LIMIT 1) AS insight_params
         FROM result_topic_scores t JOIN topics tp ON tp.id = t.topic_id JOIN subjects sj ON sj.id = t.subject_id
        WHERE t.result_id = $1`, [r.id, r.analysis_id], c)).rows;
    const topics: Topic[] = rows.map((t) => {
      const acc = Number(t.accuracy);
      const cls = t.n < cfg.minQuestions ? null : acc >= cfg.strong ? 'STRONG' : acc < cfg.weak ? 'NEEDS_IMPROVEMENT' : 'ADEQUATE';
      return { topicId: t.topic_id, name: t.name, subjectName: t.subject_name, classification: cls, accuracy: acc, correct: t.correct, n: t.n,
        targetAccuracy: Math.min(0.9, round5(Math.max(acc + 0.2, 0.6))), hasGuide: t.has_guide,
        reason: `Di ${t.name}, ${t.correct} dari ${t.n} soal benar.` };
    });
    topics.sort((a, b) => RANK[a.classification ?? 'NONE'] - RANK[b.classification ?? 'NONE'] || a.accuracy - b.accuracy || b.n - a.n || a.name.localeCompare(b.name));
    const target = await this.db.one('SELECT personal_target_score FROM student_targets WHERE user_id = $1 AND priority = 1', [userId], c);
    const prof = await this.db.one('SELECT daily_study_minutes FROM student_profiles WHERE user_id = $1', [userId], c);
    return { result: r, topics, targetScore: target?.personal_target_score ?? null, dailyMinutes: prof?.daily_study_minutes ?? 60 };
  }

  /** FR-RMP-01..03: bangun roadmap baru; roadmap aktif lama menjadi SUPERSEDED (item DONE tetap tercatat). */
  async build(userId: string) {
    return this.db.tx(async (c) => {
      const inp = await this.inputs(c, userId);
      if (!inp) return null;
      const version = String(await this.settings.get('roadmap.rule_set_version', 'rmp-2026.11', c));
      const defaultWeeks = Number(await this.settings.get('roadmap.default_horizon_weeks', 8, c));
      const start = todayWib();
      const exam = dateStr(inp.result.exam_date);
      const examKnown = !!exam && exam > start;
      let end = examKnown ? addDays(exam!, -1) : addDays(start, defaultWeeks * 7 - 1);
      if (end < start) end = start;
      const current = Math.round(Number(inp.result.total_score));
      const gap = inp.targetScore != null ? inp.targetScore - current : null;
      const k = gap != null && gap > 150 ? 3 : 2; // BR-RMP-02
      const nWeeks = Math.min(MAX_WEEKS, Math.ceil((diffDays(start, end) + 1) / 7));
      const phases: Phase[] = [];
      let idx = 0;
      const weak = inp.topics.filter((t) => t.classification === 'NEEDS_IMPROVEMENT');
      const rotate = weak.length ? weak : inp.topics;
      for (let w = 0; w < nWeeks; w++) {
        const ps = addDays(start, w * 7);
        const pe = w === nWeeks - 1 ? end : addDays(ps, 6);
        if (idx < inp.topics.length) {
          phases.push({ week: w + 1, startDate: ps, endDate: pe, kind: 'FOCUS', title: 'Fokus topik', topics: inp.topics.slice(idx, idx + k) });
          idx += k;
        } else {
          const off = (w * k) % Math.max(1, rotate.length);
          const pick = rotate.length ? Array.from({ length: Math.min(k, rotate.length) }, (_, i) => rotate[(off + i) % rotate.length]) : [];
          phases.push({ week: w + 1, startDate: ps, endDate: pe, kind: 'CONSOLIDATE', title: 'Pemantapan & simulasi', topics: pick });
        }
      }
      await c.query(`UPDATE study_plans SET status = 'SUPERSEDED' WHERE user_id = $1 AND status = 'ACTIVE'`, [userId]);
      const plan = await this.db.one(
        `INSERT INTO study_plans (user_id, result_id, rule_set_version, start_date, end_date, exam_date, daily_minutes, target_score, current_score, phases)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [userId, inp.result.id, version, start, end, examKnown ? exam : null, inp.dailyMinutes, inp.targetScore, inp.result.total_score, JSON.stringify(phases)], c);
      await this.generateItems(c, plan, start, 7);
      return plan!.id as string;
    });
  }

  /** FR-RMP-04: tugas harian untuk tanggal yang belum punya tugas (deterministik per tanggal). */
  private async generateItems(c: Tx, plan: any, from: string, days: number) {
    const phases: Phase[] = plan.phases;
    const start = dateStr(plan.start_date)!;
    const end = dateStr(plan.end_date)!;
    const res = await this.db.one('SELECT attempt_id, exam_id FROM exam_results WHERE id = $1', [plan.result_id], c);
    const series = await this.db.one('SELECT series_id FROM exams WHERE id = $1', [res.exam_id], c);
    const openPeriod = await this.db.one(
      `SELECT e.id, e.title FROM exams e WHERE e.series_id = $1 AND e.status = 'PUBLISHED' AND now() BETWEEN e.available_from AND e.available_until
          AND NOT EXISTS (SELECT 1 FROM exam_attempts a WHERE a.exam_id = e.id AND a.user_id = $2) ORDER BY e.available_from LIMIT 1`,
      [series?.series_id ?? null, plan.user_id], c);
    const existing = new Set((await c.query('SELECT DISTINCT plan_date::text AS d FROM study_plan_items WHERE plan_id = $1', [plan.id])).rows.map((r) => r.d));
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i);
      if (d < start || d > end || existing.has(d)) continue;
      const off = diffDays(start, d);
      const phase = phases[Math.min(Math.floor(off / 7), phases.length - 1)];
      if (!phase || phase.topics.length === 0) continue;
      const items: { kind: string; topicId: string | null; title: string; detail: string; minutes: number }[] = [];
      const daily = plan.daily_minutes;
      if (weekday(d) === 6 && openPeriod) {
        items.push({ kind: 'TRYOUT', topicId: null, title: 'Kerjakan try out periode berikutnya', detail: `${openPeriod.title}. Sisihkan waktu tanpa gangguan.`, minutes: Math.min(240, daily) });
      } else {
        const t = phase.topics[(off % 7) % phase.topics.length];
        let left = daily;
        if (t.hasGuide && left >= 15) { items.push({ kind: 'GUIDE', topicId: t.topicId, title: `Pelajari materi ${t.name}`, detail: `Ringkasan dan poin yang perlu dipahami di ${t.subjectName}.`, minutes: 15 }); left -= 15; }
        const wrong = t.n - t.correct;
        if (wrong > 0 && left >= 5) {
          const m = Math.min(left, Math.max(10, Math.min(30, 3 * wrong)));
          items.push({ kind: 'REVIEW', topicId: t.topicId, title: `Ulangi pembahasan ${wrong} soal ${t.name}`, detail: t.reason, minutes: m }); left -= m;
        }
        if (left >= 10) {
          items.push({ kind: 'PRACTICE', topicId: t.topicId, title: `Latihan ${t.name}`,
            detail: `Kerjakan ulang soal ${t.name} yang belum benar tanpa melihat pembahasan, lalu cocokkan langkahmu. Target akurasi ${Math.round(t.targetAccuracy * 100)}%.`, minutes: left });
        }
      }
      let pos = 1;
      for (const it of items) {
        await c.query(
          `INSERT INTO study_plan_items (plan_id, user_id, plan_date, position, kind, topic_id, title, detail, est_minutes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (plan_id, plan_date, position) DO NOTHING`,
          [plan.id, plan.user_id, d, pos++, it.kind, it.topicId, it.title, it.detail, it.minutes]);
      }
    }
  }

  private async active(userId: string, c?: Tx) {
    return this.db.one(
      `SELECT p.*, r.attempt_id FROM study_plans p JOIN exam_results r ON r.id = p.result_id WHERE p.user_id = $1 AND p.status = 'ACTIVE'`, [userId], c);
  }

  /** EP-RMP-01 */
  async roadmap(userId: string) {
    const plan = await this.active(userId);
    if (!plan) return { plan: null };
    await this.db.tx((c) => this.generateItems(c, plan, todayWib(), 7));
    const items = (await this.db.query('SELECT plan_date::text AS d, topic_id, status FROM study_plan_items WHERE plan_id = $1', [plan.id])).rows;
    const phases = (plan.phases as Phase[]).map((ph) => {
      const ids = new Set(ph.topics.map((t) => t.topicId));
      const mine = items.filter((i) => i.d >= ph.startDate && i.d <= ph.endDate && (!i.topic_id || ids.has(i.topic_id)));
      return { ...ph, progress: { done: mine.filter((i) => i.status === 'DONE').length, total: mine.length } };
    });
    const today = todayWib();
    const examDate = dateStr(plan.exam_date);
    return {
      plan: {
        id: plan.id, startDate: dateStr(plan.start_date), endDate: dateStr(plan.end_date), examDate, examDateKnown: !!examDate,
        daysToExam: examDate ? diffDays(today, examDate) : null, dailyMinutes: plan.daily_minutes,
        targetScore: plan.target_score, currentScore: Math.round(Number(plan.current_score)), attemptId: plan.attempt_id,
        ruleSetVersion: plan.rule_set_version, phases,
        progress: { done: items.filter((i) => i.status === 'DONE').length, total: items.length },
      },
    };
  }

  /** EP-RMP-02 */
  async plan(userId: string, from?: string, days = 7) {
    const plan = await this.active(userId);
    if (!plan) return { days: [] };
    const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : todayWib();
    const n = Math.min(7, Math.max(1, days));
    await this.db.tx((c) => this.generateItems(c, plan, start, n));
    const rows = (await this.db.query(
      `SELECT i.*, i.plan_date::text AS d, tp.name AS topic_name FROM study_plan_items i LEFT JOIN topics tp ON tp.id = i.topic_id
        WHERE i.plan_id = $1 AND i.plan_date BETWEEN $2::date AND $2::date + ($3::int - 1) ORDER BY i.plan_date, i.position`,
      [plan.id, start, n])).rows;
    const out: any[] = [];
    for (let i = 0; i < n; i++) {
      const d = addDays(start, i);
      const list = rows.filter((r) => r.d === d);
      out.push({ date: d, totalMinutes: list.reduce((s, r) => s + r.est_minutes, 0), items: list.map((r) => this.itemDto(r, plan.attempt_id)) });
    }
    return { days: out, dailyMinutes: plan.daily_minutes };
  }

  private itemDto(r: any, attemptId: string) {
    const link = r.kind === 'TRYOUT' ? '/app/tryout'
      : r.kind === 'REVIEW' ? `/app/hasil/${attemptId}/pembahasan?topik=${r.topic_id}`
        : `/app/materi/${r.topic_id}?tugas=${r.id}`;
    return { id: r.id, kind: r.kind, title: r.title, detail: r.detail, estMinutes: r.est_minutes, status: r.status,
      topic: r.topic_id ? { id: r.topic_id, name: r.topic_name } : null, completedAt: iso(r.completed_at), link };
  }

  /** EP-RMP-03 */
  async setDone(userId: string, itemId: string, done: boolean) {
    const r = await this.db.one(
      `UPDATE study_plan_items i SET status = $3, completed_at = CASE WHEN $3 = 'DONE' THEN now() END
         FROM study_plans p WHERE i.id = $1 AND i.user_id = $2 AND p.id = i.plan_id AND p.status = 'ACTIVE' RETURNING i.*`,
      [itemId, userId, done ? 'DONE' : 'TODO']);
    if (!r) throw notFound();
    return { item: { id: r.id, status: r.status, completedAt: iso(r.completed_at) } };
  }

  /** EP-RMP-04 / FR-RMP-07 */
  async setDailyMinutes(userId: string, minutes: number) {
    await this.db.query('UPDATE student_profiles SET daily_study_minutes = $2 WHERE user_id = $1', [userId, minutes]);
    if (await this.active(userId)) await this.build(userId);
    return this.roadmap(userId);
  }
}

@Controller() @Roles('STUDENT')
export class PlannerController {
  constructor(private planner: StudyPlanner, private db: Db) {}

  /** EP-RMP-01 */
  @Get('users/me/roadmap')
  roadmap(@CurrentUser() me: AuthUser) { return this.planner.roadmap(me.id); }

  /** EP-RMP-02 */
  @Get('users/me/plan')
  plan(@CurrentUser() me: AuthUser, @Query('from') from?: string, @Query('days') days?: string) {
    return this.planner.plan(me.id, from, days ? Number(days) : 7);
  }

  /** EP-RMP-03 */
  @Patch('users/me/plan/items/:id')
  done(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.planner.setDone(me.id, id, parse(planItemSchema, body).done);
  }

  /** EP-RMP-04 */
  @Put('users/me/study-preferences')
  prefs(@CurrentUser() me: AuthUser, @Body() body: unknown) {
    return this.planner.setDailyMinutes(me.id, parse(studyPrefsSchema, body).dailyMinutes);
  }

  /** EP-RMP-05 */
  @Get('topics/:topicId/guide')
  async guide(@Param('topicId') topicId: string) {
    const g = await this.db.one(
      `SELECT tp.id, tp.name, s.name AS subject_name, g.summary, g.key_points, g.updated_at FROM topics tp
         JOIN subjects s ON s.id = tp.subject_id LEFT JOIN topic_guides g ON g.topic_id = tp.id WHERE tp.id = $1`, [topicId]);
    if (!g) throw notFound();
    return { topic: { id: g.id, name: g.name, subjectName: g.subject_name },
      guide: g.summary ? { summary: g.summary, keyPoints: g.key_points, updatedAt: iso(g.updated_at) } : null };
  }
}

/** EP-RMP-06 + daftar untuk ADM-17 */
@Controller('admin') @Roles('CONTENT_EDITOR')
export class GuidesAdminController {
  constructor(private db: Db) {}

  @Get('topic-guides')
  async list() {
    const r = await this.db.query(
      `SELECT tp.id, tp.name, s.name AS subject_name, s.position, g.summary, g.key_points, g.updated_at
         FROM topics tp JOIN subjects s ON s.id = tp.subject_id LEFT JOIN topic_guides g ON g.topic_id = tp.id ORDER BY s.position, tp.name`);
    return { data: r.rows.map((x) => ({ topicId: x.id, topicName: x.name, subjectName: x.subject_name,
      guide: x.summary ? { summary: x.summary, keyPoints: x.key_points, updatedAt: iso(x.updated_at) } : null })) };
  }

  @Put('topics/:topicId/guide')
  async put(@CurrentUser() me: AuthUser, @Param('topicId') topicId: string, @Body() body: unknown) {
    const input = parse(guideSchema, body);
    const t = await this.db.one('SELECT 1 FROM topics WHERE id = $1', [topicId]);
    if (!t) throw notFound();
    await this.db.query(
      `INSERT INTO topic_guides (topic_id, summary, key_points, updated_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (topic_id) DO UPDATE SET summary = EXCLUDED.summary, key_points = EXCLUDED.key_points, updated_by = EXCLUDED.updated_by`,
      [topicId, input.summary, JSON.stringify(input.keyPoints), me.id]);
    return { guide: { topicId } };
  }
}
