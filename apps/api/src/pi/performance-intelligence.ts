import { Controller, Get, Injectable, Logger, OnModuleDestroy, OnModuleInit, Param, Query } from '@nestjs/common';
import { SCORE_DISCLAIMER } from '@cogniverse/contracts';
import { AppError, Db, Tx, iso, notFound } from '../common/infra';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { Settings } from '../common/settings';
import { StudyPlanner } from '../growth/planner';

/**
 * Modul PerformanceIntelligence (TDD v2.0 2.6, 6.6).
 * Tahap 1 (dipanggil di transaksi scoring): agregat kompetensi, metrik perilaku, snapshot progres, result_analyses PENDING.
 * Tahap 2 (pekerjaan terpisah): aturan ber-versi → performance_insights + learning_recommendations.
 */

// ------------------------------------------------------------------ templat bahasa (FR-PI-12, TDD 6.6.4)
const TEMPLATES: Record<string, string> = {
  'overview.summary': 'Kamu menjawab benar {correct} dari {total} soal. {unanswered} soal belum dijawab.',
  'overview.unanswered': '{unanswered} dari {total} soal belum dijawab. Soal kosong bernilai 0, sama dengan jawaban salah.',
  'cap.topic.needs_improvement': 'Di topik {topic}, {correct} dari {n} soal sudah benar ({pct}).',
  'cap.topic.adequate': 'Di topik {topic}, {correct} dari {n} soal sudah benar ({pct}). Masih ada ruang untuk naik.',
  'cap.topic.strong': 'Topik {topic} sudah kuat: {correct} dari {n} soal benar ({pct}).',
  'cap.section.gap': 'Skor {hi} ({hiScore}) dan {lo} ({loScore}) berselisih {diff} poin.',
  'beh.unanswered.end_of_section': '{count} dari {total} soal yang belum dijawab berada di bagian akhir subtes {section}.',
  'beh.time_pressure.inference': 'Pola ini dapat berarti waktumu habis sebelum mencapai soal-soal terakhir di {section}. Ini dugaan berdasarkan pengamatan di atas, bukan kesimpulan pasti.',
  'beh.easy_errors': '{wrong} soal mudah belum benar, sedangkan akurasi soal sulit {hardPct}.',
  'rec.priority_area': 'Prioritaskan {area}: {correct} dari {n} soal benar ({pct}).',
  'rec.review_explanations': 'Pelajari pembahasan {count} soal {area} yang belum benar.',
};
export const FORBIDDEN_WORDS = ['lemah', 'bodoh', 'tidak berbakat', 'kurang cerdas', 'gagal'];
export const render = (key: string, params: Record<string, any>) =>
  (TEMPLATES[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const TIER_RANK = { BASIC: 0, COMPLETE: 1 } as const;

type Q = {
  id: string; section_id: string; section_name: string; spos: number; position: number; section_count: number;
  duration_seconds: number; started_at: Date; ended_at: Date | null; difficulty: string | null;
  topic_id: string | null; topic_name: string | null; subject_id: string | null; time_ms: number; changes: number;
  sel: string | null; first_key: string | null; key: string;
};

@Injectable()
export class PerformanceIntelligence implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('PI');
  private timer?: NodeJS.Timeout;
  constructor(private db: Db, private settings: Settings, private planner: StudyPlanner) {}

  onModuleInit() {
    this.timer = setInterval(() => this.sweep().catch((e) => this.log.error(e)), 30_000);
  }
  onModuleDestroy() { clearInterval(this.timer); }

  private async questions(c: Tx, attemptId: string): Promise<Q[]> {
    return (await this.db.query(
      `SELECT aq.id, aq.attempt_section_id AS section_id, s.name AS section_name, s.position AS spos, aq.position,
              s.question_count AS section_count, s.duration_seconds, s.started_at, s.ended_at,
              qv.difficulty, qv.topic_id, tp.name AS topic_name, qv.subject_id,
              COALESCE(aa.time_spent_ms, 0)::int AS time_ms, COALESCE(aa.answer_change_count, 0) AS changes,
              so.option_key AS sel, fo.option_key AS first_key, ko.option_key AS key
         FROM attempt_questions aq
         JOIN attempt_sections s ON s.id = aq.attempt_section_id
         JOIN exam_questions eq ON eq.id = aq.exam_question_id
         JOIN question_versions qv ON qv.id = aq.question_version_id
         LEFT JOIN topics tp ON tp.id = qv.topic_id
         JOIN question_options ko ON ko.question_version_id = COALESCE(eq.scoring_version_id, aq.question_version_id) AND ko.is_correct
         LEFT JOIN attempt_answers aa ON aa.attempt_question_id = aq.id
         LEFT JOIN question_options so ON so.id = aa.selected_option_id
         LEFT JOIN question_options fo ON fo.id = aa.first_selected_option_id
        WHERE aq.attempt_id = $1 ORDER BY s.position, aq.position`, [attemptId], c)).rows;
  }

  // ------------------------------------------------------------------ tahap 1 (dalam transaksi scoring, AD-14)
  async writeAggregates(c: Tx, a: any, resultId: string, prevResultId: string | null) {
    const qs = await this.questions(c, a.id);
    const outcome = (q: Q) => (q.sel === null ? 'UNANSWERED' : q.sel === q.key ? 'CORRECT' : 'INCORRECT');

    // skor kompetensi
    await c.query(
      `INSERT INTO result_competency_scores (result_id, competency_id, question_count, correct_count, incorrect_count, unanswered_count, accuracy)
       SELECT $1, qc.competency_id, count(*),
              count(*) FILTER (WHERE x.outcome = 'CORRECT'), count(*) FILTER (WHERE x.outcome = 'INCORRECT'),
              count(*) FILTER (WHERE x.outcome = 'UNANSWERED'),
              round(count(*) FILTER (WHERE x.outcome = 'CORRECT')::numeric / count(*), 4)
         FROM unnest($2::uuid[], $3::text[]) AS x(aq_id, outcome)
         JOIN attempt_questions aq ON aq.id = x.aq_id
         JOIN question_competencies qc ON qc.question_version_id = aq.question_version_id
        GROUP BY qc.competency_id`, [resultId, qs.map((q) => q.id), qs.map(outcome)]);

    // metrik perilaku (6.6.3)
    const times = qs.map((q) => q.time_ms).filter((t) => t > 0).sort((x, y) => x - y);
    const median = times.length ? times[Math.floor((times.length - 1) / 2)] : null;
    const quart = [0, 0, 0, 0];
    for (const q of qs) if (outcome(q) === 'UNANSWERED') quart[Math.min(3, Math.ceil((q.position * 4) / q.section_count) - 1)]++;
    const bySection = new Map<string, Q[]>();
    for (const q of qs) bySection.set(q.section_id, [...(bySection.get(q.section_id) ?? []), q]);
    const sectionTime = [...bySection.values()].map((list) => {
      const s = list[0];
      const used = a.timing_mode === 'PER_SECTION' && s.ended_at
        ? Math.max(0, Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000))
        : Math.round(list.reduce((x, q) => x + q.time_ms, 0) / 1000);
      return { attemptSectionId: s.section_id, position: s.spos, name: s.section_name, usedSeconds: used,
        allottedSeconds: s.duration_seconds, indicative: a.timing_mode !== 'PER_SECTION',
        unanswered: list.filter((q) => outcome(q) === 'UNANSWERED').length,
        unansweredLastQuartile: list.filter((q) => outcome(q) === 'UNANSWERED' && q.position * 4 > q.section_count * 3).length };
    });
    const diff: Record<string, { n: number; correct: number }> = {};
    for (const q of qs) {
      const d = q.difficulty ?? 'UNKNOWN';
      diff[d] ??= { n: 0, correct: 0 };
      diff[d].n++; if (outcome(q) === 'CORRECT') diff[d].correct++;
    }
    const changed = qs.filter((q) => q.changes > 0 && q.first_key);
    const w2r = changed.filter((q) => q.first_key !== q.key && q.sel === q.key).length;
    const r2w = changed.filter((q) => q.first_key === q.key && q.sel !== q.key).length;
    const slow = median ? qs.filter((q) => q.time_ms > 3 * median && q.time_ms >= 60_000).length : 0;
    const total = Math.max(0, Math.floor((new Date(a.submitted_at).getTime() - new Date(a.started_at).getTime()) / 1000));
    await c.query(
      `INSERT INTO result_behavior_metrics (result_id, total_time_seconds, recorded_time_ms, median_time_per_question_ms,
         slow_question_count, unanswered_by_quartile, section_time, accuracy_by_difficulty, answer_changes_total,
         changes_wrong_to_right, changes_right_to_wrong)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [resultId, total, qs.reduce((x, q) => x + q.time_ms, 0), median, slow, quart, JSON.stringify(sectionTime),
       JSON.stringify(diff), qs.reduce((x, q) => x + q.changes, 0), w2r, r2w]);

    // snapshot progres (6.6.6)
    if (prevResultId) await c.query('UPDATE student_performance_snapshots SET is_current = FALSE WHERE result_id = $1 AND is_current', [prevResultId]);
    const exam = await this.db.one('SELECT series_id, exam_type FROM exams WHERE id = $1', [a.exam_id], c);
    const res = await this.db.one('SELECT total_score, correct_count, total_questions FROM exam_results WHERE id = $1', [resultId], c);
    const snap = async (scope: string, key: string, label: string, score: number | null, n: number, correct: number, extra: any = {}) =>
      c.query(
        `INSERT INTO student_performance_snapshots (user_id, result_id, attempt_id, exam_id, series_id, scoring_scheme, scope_type,
           scope_key, scope_label, subject_id, topic_id, score, accuracy, question_count, correct_count, taken_at)
         VALUES ($1,$2,$3,$4,$5,'PROPORTIONAL_V1',$6,$7,$8,$9,$10,$11, round($13::numeric / $12, 4), $12, $13, $14)`,
        [a.user_id, resultId, a.id, a.exam_id, exam.series_id, scope, key, label, extra.subjectId ?? null, extra.topicId ?? null,
         score, n, correct, a.submitted_at]);
    await snap('OVERALL', 'total', 'Skor total', Number(res.total_score), res.total_questions, res.correct_count);
    const secScores = (await this.db.query('SELECT * FROM result_section_scores WHERE result_id = $1', [resultId], c)).rows;
    for (const s of secScores) await snap('SECTION', String(s.position), s.section_name, Number(s.scaled_score), s.question_count, s.correct_count);
    const topicScores = (await this.db.query(
      `SELECT t.*, tp.name FROM result_topic_scores t JOIN topics tp ON tp.id = t.topic_id WHERE t.result_id = $1`, [resultId], c)).rows;
    for (const t of topicScores) await snap('TOPIC', t.topic_id, t.name, null, t.question_count, t.correct_count, { subjectId: t.subject_id, topicId: t.topic_id });

    const cfg = await this.settings.analytics(c);
    await c.query(
      `INSERT INTO result_analyses (result_id, user_id, rule_set_version, report_tier) VALUES ($1,$2,$3,$4)
       ON CONFLICT (result_id, rule_set_version) DO NOTHING`,
      [resultId, a.user_id, cfg.ruleSetVersion, 'COMPLETE']);
  }

  // ------------------------------------------------------------------ tahap 2 (6.6.5)
  async analyzeSafely(resultId: string) {
    try {
      await this.analyze(resultId);
      // TD-15: roadmap dibangun setelah analisis COMPLETED; kegagalan roadmap tidak menggagalkan analisis
      const r = await this.db.one(
        `SELECT r.user_id FROM exam_results r JOIN result_analyses a ON a.result_id = r.id AND a.is_current AND a.status = 'COMPLETED'
          WHERE r.id = $1 AND r.is_current`, [resultId]);
      if (r) await this.planner.buildSafely(r.user_id);
    } catch (e) {
      this.log.error(`Analisis gagal untuk result ${resultId}: ${(e as Error).message}`);
      await this.db.query(
        `UPDATE result_analyses SET status = 'FAILED', error_message = $2 WHERE result_id = $1 AND status IN ('PENDING','RUNNING')`,
        [resultId, String((e as Error).message).slice(0, 500)]).catch(() => {});
    }
  }

  async sweep() {
    const due = await this.db.query(
      `SELECT DISTINCT result_id FROM result_analyses WHERE status IN ('PENDING','FAILED') AND run_count < 5 LIMIT 50`);
    for (const r of due.rows) await this.analyzeSafely(r.result_id);
  }

  async analyze(resultId: string) {
    const cfg = await this.settings.analytics();
    await this.db.tx(async (c) => {
      const r = await this.db.one(
        `SELECT r.*, a.status AS attempt_status, a.timing_mode, e.exam_type FROM exam_results r
           JOIN exam_attempts a ON a.id = r.attempt_id JOIN exams e ON e.id = r.exam_id
          WHERE r.id = $1 AND r.is_current FOR SHARE OF r`, [resultId], c);
      if (!r || r.attempt_status === 'VOIDED') return; // BR-PI-07
      const an = await this.db.one(
        `UPDATE result_analyses SET status = 'RUNNING', run_count = run_count + 1, started_at = now(), error_message = NULL
          WHERE result_id = $1 AND rule_set_version = $2 AND status IN ('PENDING','FAILED') RETURNING *`,
        [resultId, cfg.ruleSetVersion], c);
      if (!an) return; // sudah COMPLETED atau sedang berjalan (idempotent, TC-PI-02)
      const tier: 'BASIC' | 'COMPLETE' = an.report_tier;

      const sections = (await this.db.query('SELECT * FROM result_section_scores WHERE result_id = $1 ORDER BY position', [resultId], c)).rows;
      const topics = (await this.db.query(
        `SELECT t.*, tp.name AS topic_name, s.name AS subject_name FROM result_topic_scores t
           JOIN topics tp ON tp.id = t.topic_id JOIN subjects s ON s.id = t.subject_id WHERE t.result_id = $1`, [resultId], c)).rows;
      const beh = await this.db.one('SELECT * FROM result_behavior_metrics WHERE result_id = $1', [resultId], c);
      const qs = await this.questions(c, r.attempt_id);
      const outcome = (q: Q) => (q.sel === null ? 'UNANSWERED' : q.sel === q.key ? 'CORRECT' : 'INCORRECT');

      let order = 0;
      const ins = async (x: { dimension: string; kind: 'OBSERVATION' | 'INFERENCE'; rule: string; scope: string; tierMin: 'BASIC' | 'COMPLETE';
        key: string; params: any; evidence: any; topicId?: string; subjectId?: string; sectionId?: string; difficulty?: string;
        classification?: string; basedOn?: string }) => {
        const row = await this.db.one(
          `INSERT INTO performance_insights (analysis_id, user_id, dimension, kind, rule_code, scope_type, subject_id, topic_id,
             attempt_section_id, difficulty, classification, min_report_tier, message_key, params, evidence, based_on_insight_id, display_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
          [an.id, r.user_id, x.dimension, x.kind, x.rule, x.scope, x.subjectId ?? null, x.topicId ?? null, x.sectionId ?? null,
           x.difficulty ?? null, x.classification ?? null, x.tierMin, x.key, JSON.stringify(x.params), JSON.stringify(x.evidence),
           x.basedOn ?? null, order++], c);
        return row!.id as string;
      };

      // OBS-OVR-01/02
      await ins({ dimension: 'OVERVIEW', kind: 'OBSERVATION', rule: 'OBS-OVR-01', scope: 'ATTEMPT', tierMin: 'BASIC', key: 'overview.summary',
        params: { correct: r.correct_count, total: r.total_questions, unanswered: r.unanswered_count },
        evidence: { metrics: { correct: r.correct_count, incorrect: r.incorrect_count, unanswered: r.unanswered_count } } });
      if (Number(r.completion_rate) < 0.8) {
        await ins({ dimension: 'OVERVIEW', kind: 'OBSERVATION', rule: 'OBS-OVR-02', scope: 'ATTEMPT', tierMin: 'BASIC', key: 'overview.unanswered',
          params: { unanswered: r.unanswered_count, total: r.total_questions },
          evidence: { attemptQuestionIds: qs.filter((q) => outcome(q) === 'UNANSWERED').map((q) => q.id) } });
      }
      // OBS-CAP-01/02 + kandidat area prioritas
      const qOf = (topicId: string) => qs.filter((q) => q.topic_id === topicId).map((q) => q.id);
      const areas: { insightId: string; t: any }[] = [];
      for (const t of [...topics].sort((x, y) => Number(x.accuracy) - Number(y.accuracy) || y.question_count - x.question_count)) {
        if (t.question_count < cfg.minQuestions) continue; // BR-PI-02
        const acc = Number(t.accuracy);
        const params = { topic: t.topic_name, correct: t.correct_count, n: t.question_count, pct: pct(acc) };
        if (acc < cfg.weak) {
          const id = await ins({ dimension: 'CAPABILITY', kind: 'OBSERVATION', rule: 'OBS-CAP-01', scope: 'TOPIC', tierMin: 'BASIC',
            key: 'cap.topic.needs_improvement', params, evidence: { attemptQuestionIds: qOf(t.topic_id), metrics: params },
            topicId: t.topic_id, subjectId: t.subject_id, classification: 'NEEDS_IMPROVEMENT' });
          areas.push({ insightId: id, t });
        } else if (acc >= cfg.strong) {
          await ins({ dimension: 'CAPABILITY', kind: 'OBSERVATION', rule: 'OBS-CAP-02', scope: 'TOPIC', tierMin: 'COMPLETE',
            key: 'cap.topic.strong', params, evidence: { attemptQuestionIds: qOf(t.topic_id), metrics: params },
            topicId: t.topic_id, subjectId: t.subject_id, classification: 'STRONG' });
        }
      }
      if (areas.length === 0) { // fallback: topik ADEQUATE terendah
        const t = [...topics].filter((x) => x.question_count >= cfg.minQuestions && Number(x.accuracy) < cfg.strong)
          .sort((x, y) => Number(x.accuracy) - Number(y.accuracy))[0];
        if (t) {
          const params = { topic: t.topic_name, correct: t.correct_count, n: t.question_count, pct: pct(Number(t.accuracy)) };
          const id = await ins({ dimension: 'CAPABILITY', kind: 'OBSERVATION', rule: 'OBS-CAP-01', scope: 'TOPIC', tierMin: 'BASIC',
            key: 'cap.topic.adequate', params, evidence: { attemptQuestionIds: qOf(t.topic_id), metrics: params },
            topicId: t.topic_id, subjectId: t.subject_id, classification: 'ADEQUATE' });
          areas.push({ insightId: id, t });
        }
      }
      // OBS-CAP-03
      if (sections.length >= 2) {
        const sorted = [...sections].sort((x, y) => Number(y.scaled_score) - Number(x.scaled_score));
        const hi = sorted[0], lo = sorted[sorted.length - 1];
        const d = Math.round(Number(hi.scaled_score) - Number(lo.scaled_score));
        if (d >= 200) {
          await ins({ dimension: 'CAPABILITY', kind: 'OBSERVATION', rule: 'OBS-CAP-03', scope: 'SECTION', tierMin: 'BASIC', key: 'cap.section.gap',
            params: { hi: hi.section_name, hiScore: Math.round(Number(hi.scaled_score)), lo: lo.section_name, loScore: Math.round(Number(lo.scaled_score)), diff: d },
            evidence: { metrics: { hi: hi.section_name, lo: lo.section_name } }, sectionId: lo.attempt_section_id });
        }
      }
      // OBS-BEH-01 → INF-BEH-01
      const st: any[] = beh?.section_time ?? [];
      const totalUnanswered = st.reduce((x, s) => x + s.unanswered, 0);
      const worst = [...st].sort((x, y) => y.unansweredLastQuartile - x.unansweredLastQuartile)[0];
      if (worst && totalUnanswered >= 3 && worst.unansweredLastQuartile >= 0.6 * totalUnanswered) {
        const sq = qs.filter((q) => q.section_id === worst.attemptSectionId && outcome(q) === 'UNANSWERED').map((q) => q.id);
        const obs = await ins({ dimension: 'BEHAVIOR', kind: 'OBSERVATION', rule: 'OBS-BEH-01', scope: 'SECTION', tierMin: 'BASIC',
          key: 'beh.unanswered.end_of_section', params: { count: worst.unansweredLastQuartile, total: totalUnanswered, section: worst.name },
          evidence: { attemptQuestionIds: sq, metrics: { quartiles: beh.unanswered_by_quartile } }, sectionId: worst.attemptSectionId });
        if (worst.allottedSeconds > 0 && worst.usedSeconds >= 0.95 * worst.allottedSeconds) {
          await ins({ dimension: 'BEHAVIOR', kind: 'INFERENCE', rule: 'INF-BEH-01', scope: 'SECTION', tierMin: 'COMPLETE',
            key: 'beh.time_pressure.inference', params: { section: worst.name },
            evidence: { metrics: { usedSeconds: worst.usedSeconds, allottedSeconds: worst.allottedSeconds } },
            sectionId: worst.attemptSectionId, basedOn: obs });
        }
      }
      // OBS-BEH-02
      const dif = beh?.accuracy_by_difficulty ?? {};
      const easy = dif.EASY, hard = dif.HARD;
      if (easy && hard && easy.n >= 3 && hard.n >= 3 && easy.n - easy.correct >= 3 && easy.correct / easy.n < hard.correct / hard.n) {
        await ins({ dimension: 'BEHAVIOR', kind: 'OBSERVATION', rule: 'OBS-BEH-02', scope: 'DIFFICULTY', tierMin: 'COMPLETE', key: 'beh.easy_errors',
          params: { wrong: easy.n - easy.correct, hardPct: pct(hard.correct / hard.n) },
          evidence: { attemptQuestionIds: qs.filter((q) => q.difficulty === 'EASY' && outcome(q) !== 'CORRECT').map((q) => q.id) }, difficulty: 'EASY' });
      }
      // REC-PRI-01 + REC-ACT-01 (simpan 5; tampilan BASIC dibatasi 3 oleh rank)
      let rank = 1;
      for (const { insightId, t } of areas.slice(0, 5)) {
        const base = [an.id, r.user_id, t.topic_id, insightId];
        await c.query(
          `INSERT INTO learning_recommendations (analysis_id, user_id, rank, recommendation_type, target_type, topic_id, subject_id,
             rationale_insight_id, rule_code, min_report_tier, message_key, params)
           VALUES ($1,$2,$5,'PRIORITY_AREA','TOPIC',$3,$6,$4,'REC-PRI-01',$7,'rec.priority_area',$8)`,
          [...base, rank, t.subject_id, rank <= 3 ? 'BASIC' : 'COMPLETE',
           JSON.stringify({ area: t.topic_name, correct: t.correct_count, n: t.question_count, pct: pct(Number(t.accuracy)) })]);
        await c.query(
          `INSERT INTO learning_recommendations (analysis_id, user_id, rank, recommendation_type, target_type, topic_id, subject_id,
             rationale_insight_id, rule_code, min_report_tier, message_key, params)
           VALUES ($1,$2,$5,'REVIEW_EXPLANATIONS','TOPIC',$3,$6,$4,'REC-ACT-01',$7,'rec.review_explanations',$8)`,
          [...base, rank, t.subject_id, rank <= 3 ? 'BASIC' : 'COMPLETE',
           JSON.stringify({ area: t.topic_name, count: t.question_count - t.correct_count })]);
        rank++;
      }
      await c.query('UPDATE result_analyses SET is_current = FALSE WHERE result_id = $1 AND is_current', [resultId]);
      await c.query(`UPDATE result_analyses SET status = 'COMPLETED', is_current = TRUE, completed_at = now() WHERE id = $1`, [an.id]);
      void tier;
    });
  }

  // ------------------------------------------------------------------ EP-PI-01
  async report(userId: string, attemptId: string) {
    const a = await this.db.one(
      `SELECT a.*, e.title, e.exam_type, e.series_id FROM exam_attempts a JOIN exams e ON e.id = a.exam_id WHERE a.id = $1 AND a.user_id = $2`,
      [attemptId, userId]);
    if (!a) throw notFound();
    if (a.status === 'VOIDED') throw new AppError('ATTEMPT_VOIDED', 'Pengerjaan ini dibatalkan oleh admin.');
    const r = await this.db.one('SELECT * FROM exam_results WHERE attempt_id = $1 AND is_current', [attemptId]);
    if (!r) throw new AppError('RESULT_PROCESSING', 'Hasilmu sedang dihitung. Biasanya kurang dari satu menit.');
    if (r.publication_status !== 'PUBLISHED') throw new AppError('RESULT_NOT_PUBLISHED', 'Hasil belum diumumkan.');
    const cfg = await this.settings.analytics();
    const tier = 'COMPLETE' as 'BASIC' | 'COMPLETE'; // v3.0: satu tingkat laporan
    const sections = (await this.db.query('SELECT * FROM result_section_scores WHERE result_id = $1 ORDER BY position', [r.id])).rows;
    const topics = (await this.db.query(
      `SELECT t.*, tp.name AS topic_name, s.name AS subject_name FROM result_topic_scores t
         JOIN topics tp ON tp.id = t.topic_id JOIN subjects s ON s.id = t.subject_id WHERE t.result_id = $1
        ORDER BY t.accuracy, t.question_count DESC`, [r.id])).rows;
    const beh = await this.db.one('SELECT * FROM result_behavior_metrics WHERE result_id = $1', [r.id]);
    const an = await this.db.one(
      `SELECT * FROM result_analyses WHERE result_id = $1 ORDER BY is_current DESC, created_at DESC LIMIT 1`, [r.id]);
    const done = an?.status === 'COMPLETED';
    const ok = (min: string) => TIER_RANK[min as 'BASIC'] <= TIER_RANK[tier];
    const insights = done ? (await this.db.query(
      'SELECT * FROM performance_insights WHERE analysis_id = $1 ORDER BY display_order', [an.id])).rows.filter((i) => ok(i.min_report_tier)) : [];
    const recs = done ? (await this.db.query(
      `SELECT r.*, tp.name AS topic_name FROM learning_recommendations r LEFT JOIN topics tp ON tp.id = r.topic_id
        WHERE r.analysis_id = $1 AND r.status = 'ACTIVE' ORDER BY r.rank, r.recommendation_type`, [an.id])).rows.filter((x) => ok(x.min_report_tier)) : [];
    const classify = (n: number, acc: number) => (n < cfg.minQuestions ? null : acc >= cfg.strong ? 'STRONG' : acc < cfg.weak ? 'NEEDS_IMPROVEMENT' : 'ADEQUATE');
    const allTopics = topics.map((t) => ({ topicId: t.topic_id, topicName: t.topic_name, subjectName: t.subject_name, questionCount: t.question_count,
      correctCount: t.correct_count, accuracy: Number(t.accuracy), classification: classify(t.question_count, Number(t.accuracy)) }));
    const prioritized = allTopics.filter((t) => t.classification !== null);
    const shownTopics = tier === 'BASIC' ? prioritized.slice(0, 3) : allTopics;
    const priority = recs.filter((x) => x.recommendation_type === 'PRIORITY_AREA');
    // BASIC: insight per topik hanya untuk topik yang ditampilkan di bagian 3, agar topik tersembunyi tidak bocor (5.9.3)
    const shownTopicIds = new Set(shownTopics.map((t) => t.topicId));
    const visibleInsights = tier === 'BASIC' ? insights.filter((i) => !i.topic_id || shownTopicIds.has(i.topic_id)) : insights;
    return {
      attempt: { id: a.id, examTitle: a.title, examType: a.exam_type, submittedAt: iso(a.submitted_at), submissionType: a.submission_type },
      reportTier: tier,
      analysisStatus: an?.status ?? 'PENDING',
      overview: { totalScore: Number(r.total_score), accuracy: Number(r.accuracy), completionRate: Number(r.completion_rate),
        correctCount: r.correct_count, incorrectCount: r.incorrect_count, unansweredCount: r.unanswered_count,
        totalQuestions: r.total_questions, durationSeconds: r.duration_seconds },
      sections: sections.map((s) => ({ name: s.section_name, position: s.position, scaledScore: Number(s.scaled_score), correctCount: s.correct_count,
        incorrectCount: s.incorrect_count, unansweredCount: s.unanswered_count, questionCount: s.question_count })),
      topics: shownTopics,
      hiddenTopicCount: allTopics.length - shownTopics.length,
      thresholds: { minQuestions: cfg.minQuestions, strong: cfg.strong, weak: cfg.weak },
      behavior: beh ? (tier === 'BASIC'
        ? { durationSeconds: beh.total_time_seconds, unansweredCount: r.unanswered_count }
        : { durationSeconds: beh.total_time_seconds, unansweredCount: r.unanswered_count, sectionTime: beh.section_time,
            unansweredByQuartile: beh.unanswered_by_quartile, accuracyByDifficulty: beh.accuracy_by_difficulty,
            answerChanges: { total: beh.answer_changes_total, wrongToRight: beh.changes_wrong_to_right, rightToWrong: beh.changes_right_to_wrong },
            medianTimePerQuestionMs: beh.median_time_per_question_ms, slowQuestionCount: beh.slow_question_count }) : null,
      insights: visibleInsights.map((i) => ({ id: i.id, dimension: i.dimension, kind: i.kind, ruleCode: i.rule_code, classification: i.classification, topicId: i.topic_id,
        text: render(i.message_key, i.params), basedOn: i.based_on_insight_id,
        basis: i.based_on_insight_id ? (() => { const b = insights.find((x) => x.id === i.based_on_insight_id); return b ? render(b.message_key, b.params) : null; })() : null,
        hasEvidence: Array.isArray(i.evidence?.attemptQuestionIds) && i.evidence.attemptQuestionIds.length > 0 })),
      recommendations: priority.map((p) => {
        const act = recs.find((x) => x.recommendation_type === 'REVIEW_EXPLANATIONS' && x.rank === p.rank);
        return { id: p.id, rank: p.rank, target: { type: p.target_type, topicId: p.topic_id, name: p.topic_name },
          text: render(p.message_key, p.params), insightId: p.rationale_insight_id,
          action: act ? { type: 'REVIEW_EXPLANATIONS', text: render(act.message_key, act.params), topicId: act.topic_id } : null };
      }),
      lockedSections: [],
      disclaimer: SCORE_DISCLAIMER,
      limitations: 'Analisis ini berdasarkan satu try out dan tidak menggambarkan kemampuanmu secara utuh. Kerjakan periode berikutnya dalam musim yang sama untuk melihat kemajuanmu.',
    };
  }

  // ------------------------------------------------------------------ EP-PI-02
  async evidence(userId: string, attemptId: string, insightId: string) {
    const i = await this.db.one(
      `SELECT pi.*, ra.result_id FROM performance_insights pi JOIN result_analyses ra ON ra.id = pi.analysis_id
         JOIN exam_results r ON r.id = ra.result_id
        WHERE pi.id = $1 AND pi.user_id = $2 AND r.attempt_id = $3 AND ra.is_current`, [insightId, userId, attemptId]);
    if (!i) throw notFound();
    const a = await this.db.one('SELECT session_id FROM exam_attempts WHERE id = $1', [attemptId]);
    let reviewOpen = true;
    if (a?.session_id) reviewOpen = !!(await this.db.one('SELECT 1 FROM exam_sessions WHERE id = $1 AND hard_end_at <= now()', [a.session_id]));
    const ids: string[] = i.evidence?.attemptQuestionIds ?? [];
    const rows = ids.length ? (await this.db.query(
      `SELECT aq.id, aq.position, s.position AS spos, s.name AS section_name, tp.name AS topic_name, qv.difficulty,
              COALESCE(aa.time_spent_ms, 0) AS time_ms, so.option_key AS sel, ko.option_key AS key
         FROM attempt_questions aq JOIN attempt_sections s ON s.id = aq.attempt_section_id
         JOIN exam_questions eq ON eq.id = aq.exam_question_id
         JOIN question_versions qv ON qv.id = aq.question_version_id LEFT JOIN topics tp ON tp.id = qv.topic_id
         JOIN question_options ko ON ko.question_version_id = COALESCE(eq.scoring_version_id, aq.question_version_id) AND ko.is_correct
         LEFT JOIN attempt_answers aa ON aa.attempt_question_id = aq.id LEFT JOIN question_options so ON so.id = aa.selected_option_id
        WHERE aq.attempt_id = $1 AND aq.id = ANY($2::uuid[]) ORDER BY s.position, aq.position`, [attemptId, ids])).rows : [];
    const offsets = (await this.db.query(
      'SELECT position, question_count FROM attempt_sections WHERE attempt_id = $1 ORDER BY position', [attemptId])).rows;
    const base = new Map<number, number>(); let acc = 0;
    for (const s of offsets) { base.set(s.position, acc); acc += s.question_count; }
    const basedOn = i.based_on_insight_id ? await this.db.one('SELECT * FROM performance_insights WHERE id = $1', [i.based_on_insight_id]) : null;
    return {
      insight: { id: i.id, kind: i.kind, dimension: i.dimension, ruleCode: i.rule_code, text: render(i.message_key, i.params) },
      basedOn: basedOn ? { id: basedOn.id, text: render(basedOn.message_key, basedOn.params) } : null,
      evidence: {
        // Tanpa kunci jawaban (TC-PI-10); hasil per soal hanya bila pembahasan sudah boleh dibuka (BR-PUB-04)
        questions: rows.map((q) => ({ number: base.get(q.spos)! + q.position, sectionName: q.section_name, topicName: q.topic_name,
          difficulty: q.difficulty, timeSpentMs: Number(q.time_ms),
          outcome: reviewOpen ? (q.sel === null ? 'UNANSWERED' : q.sel === q.key ? 'CORRECT' : 'INCORRECT') : null })),
        metrics: i.evidence?.metrics ?? {},
      },
    };
  }

  // ------------------------------------------------------------------ EP-PRG-01 / 02
  async progress(userId: string) {
    const rows = (await this.db.query(
      `SELECT s.*, e.title, sr.name AS series_name FROM student_performance_snapshots s
         JOIN exams e ON e.id = s.exam_id LEFT JOIN exam_series sr ON sr.id = s.series_id
        WHERE s.user_id = $1 AND s.is_current AND s.scope_type IN ('OVERALL','SECTION')
        ORDER BY s.taken_at`, [userId])).rows;
    const series = new Map<string, any>();
    const unseries: any[] = [];
    for (const r of rows) {
      if (!r.series_id) {
        if (r.scope_type === 'OVERALL') unseries.push({ attemptId: r.attempt_id, examTitle: r.title, takenAt: iso(r.taken_at), totalScore: Number(r.score) });
        continue;
      }
      const s = series.get(r.series_id) ?? { id: r.series_id, name: r.series_name, attempts: [], sections: new Map() };
      if (r.scope_type === 'OVERALL') s.attempts.push({ attemptId: r.attempt_id, examTitle: r.title, takenAt: iso(r.taken_at), totalScore: Number(r.score) });
      else {
        const sec = s.sections.get(r.scope_key) ?? { position: Number(r.scope_key), label: r.scope_label, points: [] };
        sec.points.push({ attemptId: r.attempt_id, takenAt: iso(r.taken_at), score: Number(r.score) });
        s.sections.set(r.scope_key, sec);
      }
      series.set(r.series_id, s);
    }
    return {
      series: [...series.values()].map((s) => ({ id: s.id, name: s.name, attempts: s.attempts,
        sections: [...s.sections.values()].sort((x: any, y: any) => x.position - y.position) })),
      unseriesAttempts: unseries,
    };
  }

  async compare(userId: string, aId: string, bId: string) {
    const cfg = await this.settings.analytics();
    const load = (id: string) => this.db.query(
      `SELECT * FROM student_performance_snapshots WHERE user_id = $1 AND attempt_id = $2 AND is_current`, [userId, id]);
    const [A, B] = [(await load(aId)).rows, (await load(bId)).rows];
    if (!A.length || !B.length) throw notFound();
    const sa = A[0], sb = B[0];
    if (!sa.series_id || sa.series_id !== sb.series_id || sa.scoring_scheme !== sb.scoring_scheme) {
      return { comparable: false, reason: !sa.series_id || !sb.series_id
        ? 'Salah satu try out tidak termasuk seri, jadi soal dan tingkat kesulitannya tidak setara.'
        : 'Kedua try out berasal dari seri yang berbeda, jadi perbandingannya tidak adil.' };
    }
    const key = (r: any) => `${r.scope_type}:${r.scope_key}`;
    const mb = new Map(B.map((r) => [key(r), r]));
    const rows = [];
    for (const ra of A) {
      const rb: any = mb.get(key(ra));
      if (!rb) continue;
      if (ra.scope_type === 'TOPIC' && (ra.question_count < cfg.minQuestions || rb.question_count < cfg.minQuestions)) continue; // BR-PRG-04
      const ds = ra.score !== null && rb.score !== null ? Number(rb.score) - Number(ra.score) : null;
      const da = Number(rb.accuracy) - Number(ra.accuracy);
      const same = ds !== null ? Math.abs(ds) < cfg.sameScoreDelta : Math.abs(da) < cfg.sameAccuracyDelta;
      rows.push({ scopeType: ra.scope_type, label: ra.scope_label, a: ra.score !== null ? Number(ra.score) : Number(ra.accuracy),
        b: rb.score !== null ? Number(rb.score) : Number(rb.accuracy), unit: ra.score !== null ? 'score' : 'accuracy',
        delta: ds ?? da, direction: same ? 'SAME' : (ds ?? da) > 0 ? 'UP' : 'DOWN' });
    }
    return { comparable: true, rows };
  }
}

@Controller() @Roles('STUDENT')
export class PerformanceIntelligenceController {
  constructor(private pi: PerformanceIntelligence) {}
  /** EP-PI-01 */
  @Get('attempts/:id/report')
  report(@CurrentUser() me: AuthUser, @Param('id') id: string) { return this.pi.report(me.id, id); }
  /** EP-PI-02 */
  @Get('attempts/:id/insights/:insightId')
  evidence(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('insightId') iid: string) { return this.pi.evidence(me.id, id, iid); }
  /** EP-PRG-01 */
  @Get('users/me/progress')
  progress(@CurrentUser() me: AuthUser) { return this.pi.progress(me.id); }
  /** EP-PRG-02 */
  @Get('users/me/progress/compare')
  compare(@CurrentUser() me: AuthUser, @Query('a') a: string, @Query('b') b: string) { return this.pi.compare(me.id, a, b); }
}
