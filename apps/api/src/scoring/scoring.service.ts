import { Injectable, Logger } from '@nestjs/common';
import { SCORE_DISCLAIMER } from '@cogniverse/contracts';
import { AppError, Db, iso, notFound } from '../common/infra';
import { PerformanceIntelligence } from '../pi/performance-intelligence';

// FR-ANL-02 / TDD 9.3: TOPIC_STRONG_THRESHOLD, TOPIC_WEAK_THRESHOLD, TOPIC_MIN_QUESTIONS
const STRONG = Number(process.env.TOPIC_STRONG_THRESHOLD ?? 0.8);
const WEAK = Number(process.env.TOPIC_WEAK_THRESHOLD ?? 0.5);
const MIN_Q = Number(process.env.TOPIC_MIN_QUESTIONS ?? 3);

/** "Cukup" tidak memiliki nama enum di dokumen (UI/UX 9.3 menulis "(di antara)"); dipakai ADEQUATE. */
export function classifyTopic(questionCount: number, accuracy: number) {
  if (questionCount < MIN_Q) return null;
  if (accuracy >= STRONG) return 'STRONG';
  if (accuracy < WEAK) return 'NEEDS_IMPROVEMENT';
  return 'ADEQUATE';
}

/**
 * Scoring (TDD 6.5.1). Seluruh pembulatan dilakukan PostgreSQL NUMERIC agar dapat direproduksi.
 * Hasil per soal dibandingkan lewat option_key (AD-11).
 */
const OUTCOMES_CTE = `
  WITH q AS (
    SELECT aq.id AS attempt_question_id, aq.attempt_section_id, aq.weight, qv.subject_id, qv.topic_id,
           so.option_key AS selected_key, ko.option_key AS correct_key
      FROM attempt_questions aq
      JOIN exam_questions eq ON eq.id = aq.exam_question_id
      JOIN question_versions qv ON qv.id = aq.question_version_id
      JOIN question_options ko ON ko.question_version_id = COALESCE(eq.scoring_version_id, aq.question_version_id) AND ko.is_correct
      LEFT JOIN attempt_answers aa ON aa.attempt_question_id = aq.id
      LEFT JOIN question_options so ON so.id = aa.selected_option_id
     WHERE aq.attempt_id = $1
  ), o AS (
    SELECT *, CASE WHEN selected_key IS NULL THEN 'UNANSWERED'
                   WHEN selected_key = correct_key THEN 'CORRECT' ELSE 'INCORRECT' END AS outcome
      FROM q
  )`;

@Injectable()
export class ScoringService {
  private log = new Logger('Scoring');
  constructor(private db: Db, private pi: PerformanceIntelligence) {}

  async scoreSafely(attemptId: string) {
    try {
      await this.scoreAttempt(attemptId);
    } catch (e) {
      // FR-SCR-01 AC3: dicoba ulang oleh sweeper; attempt tetap SUBMITTED
      this.log.error(`Scoring gagal untuk attempt ${attemptId}: ${(e as Error).message}`);
    }
  }

  async scoreAttempt(attemptId: string, reason: string | null = null) {
    const resultId = await this.db.tx(async (c): Promise<string | null> => {
      const a = await this.db.one('SELECT * FROM exam_attempts WHERE id = $1 FOR UPDATE', [attemptId], c);
      if (!a || !['SUBMITTED', 'SCORED'].includes(a.status)) return null;
      const count = await this.db.one(`${OUTCOMES_CTE} SELECT count(*)::int AS n FROM o`, [attemptId], c);
      if (count.n !== a.total_questions) {
        throw new Error(`soal tanpa kunci valid: ${count.n}/${a.total_questions} (EC-12)`);
      }
      const sections = (await this.db.query(
        `${OUTCOMES_CTE}
         SELECT s.id AS attempt_section_id, s.name, s.position, s.question_count,
                count(*) FILTER (WHERE o.outcome = 'CORRECT')::int AS correct,
                count(*) FILTER (WHERE o.outcome = 'INCORRECT')::int AS incorrect,
                count(*) FILTER (WHERE o.outcome = 'UNANSWERED')::int AS unanswered,
                COALESCE(sum(o.weight) FILTER (WHERE o.outcome = 'CORRECT'), 0)::numeric(8,2) AS raw,
                sum(o.weight)::numeric(8,2) AS max,
                round(COALESCE(sum(o.weight) FILTER (WHERE o.outcome = 'CORRECT'), 0) / sum(o.weight) * 1000, 2) AS scaled
           FROM o JOIN attempt_sections s ON s.id = o.attempt_section_id
          GROUP BY s.id ORDER BY s.position`, [attemptId], c)).rows;
      const topics = (await this.db.query(
        `${OUTCOMES_CTE}
         SELECT subject_id, topic_id, count(*)::int AS n,
                count(*) FILTER (WHERE outcome = 'CORRECT')::int AS correct,
                count(*) FILTER (WHERE outcome = 'INCORRECT')::int AS incorrect,
                count(*) FILTER (WHERE outcome = 'UNANSWERED')::int AS unanswered,
                round(count(*) FILTER (WHERE outcome = 'CORRECT')::numeric / count(*), 4) AS accuracy
           FROM o GROUP BY subject_id, topic_id`, [attemptId], c)).rows;
      const totals = await this.db.one(
        `SELECT round(avg(x.scaled), 2) AS total_score FROM (SELECT unnest($1::numeric[]) AS scaled) x`,
        [sections.map((s) => s.scaled)], c);
      const correct = sections.reduce((s, x) => s + x.correct, 0);
      const incorrect = sections.reduce((s, x) => s + x.incorrect, 0);
      const unanswered = sections.reduce((s, x) => s + x.unanswered, 0);
      const answered = correct + incorrect;
      const ratios = await this.db.one(
        `SELECT CASE WHEN $2::int = 0 THEN 0 ELSE round($1::numeric / $2, 4) END AS accuracy,
                round($2::numeric / $3, 4) AS completion,
                GREATEST(0, floor(extract(epoch FROM ($4::timestamptz - $5::timestamptz))))::int AS duration`,
        [correct, answered, a.total_questions, a.submitted_at, a.started_at], c);

      const prev = await this.db.one('SELECT * FROM exam_results WHERE attempt_id = $1 AND is_current', [attemptId], c);
      if (prev && Number(prev.total_score) === Number(totals.total_score) && prev.correct_count === correct
          && prev.incorrect_count === incorrect && prev.unanswered_count === unanswered) {
        if (a.status === 'SUBMITTED') await c.query(`UPDATE exam_attempts SET status = 'SCORED', scored_at = now() WHERE id = $1`, [a.id]);
        return null;
      }
      if (prev) await c.query('UPDATE exam_results SET is_current = FALSE WHERE id = $1', [prev.id]);
      // 6.5.2: on-demand terbit segera (BR-PUB-01). Scheduled belum diaktifkan pada tonggak ini.
      const published = a.session_id === null || prev?.publication_status === 'PUBLISHED';
      const res = await this.db.one(
        `INSERT INTO exam_results (attempt_id, revision, is_current, user_id, exam_id, session_id, total_score, total_questions,
           correct_count, incorrect_count, unanswered_count, accuracy, completion_rate, duration_seconds,
           publication_status, published_at, revision_reason)
         VALUES ($1,$2,TRUE,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, CASE WHEN $14 = 'PUBLISHED' THEN now() END, $15)
         RETURNING id`,
        [a.id, (prev?.revision ?? 0) + 1, a.user_id, a.exam_id, a.session_id, totals.total_score, a.total_questions,
         correct, incorrect, unanswered, ratios.accuracy, ratios.completion, ratios.duration,
         published ? 'PUBLISHED' : 'PENDING_PUBLICATION', reason], c);
      for (const s of sections) {
        await c.query(
          `INSERT INTO result_section_scores (result_id, attempt_section_id, section_name, position, question_count,
             correct_count, incorrect_count, unanswered_count, raw_score, max_score, scaled_score)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [res!.id, s.attempt_section_id, s.name, s.position, s.question_count, s.correct, s.incorrect, s.unanswered, s.raw, s.max, s.scaled]);
      }
      for (const t of topics) {
        await c.query(
          `INSERT INTO result_topic_scores (result_id, subject_id, topic_id, question_count, correct_count, incorrect_count, unanswered_count, accuracy)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [res!.id, t.subject_id, t.topic_id, t.n, t.correct, t.incorrect, t.unanswered, t.accuracy]);
      }
      // TDD 6.6.2: agregat Performance Intelligence ditulis dalam transaksi yang sama
      await this.pi.writeAggregates(c, a, res!.id, prev?.id ?? null);
      if (a.status === 'SUBMITTED') await c.query(`UPDATE exam_attempts SET status = 'SCORED', scored_at = now() WHERE id = $1`, [a.id]);
      return res!.id;
    });
    // Tahap 2 di luar transaksi scoring: kegagalan analisis tidak membatalkan skor (BR-PI-06)
    if (resultId) await this.pi.analyzeSafely(resultId);
  }

  private async ownedFinished(userId: string, attemptId: string) {
    const a = await this.db.one(
      `SELECT a.*, e.title, e.delivery_mode, e.exam_type, e.slug FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
        WHERE a.id = $1 AND a.user_id = $2`, [attemptId, userId]);
    if (!a) throw notFound();
    if (a.status === 'VOIDED') throw new AppError('ATTEMPT_VOIDED', 'Pengerjaan ini dibatalkan oleh admin.');
    if (a.status === 'IN_PROGRESS') throw new AppError('ATTEMPT_NOT_IN_PROGRESS', 'Ujian ini masih berlangsung.');
    if (a.status === 'SUBMITTED') {
      await this.scoreSafely(attemptId);
      const again = await this.db.one('SELECT status FROM exam_attempts WHERE id = $1', [attemptId]);
      if (again.status !== 'SCORED') throw new AppError('RESULT_PROCESSING', 'Hasil sedang diproses. Muat ulang dalam beberapa detik.');
    }
    const r = await this.db.one('SELECT * FROM exam_results WHERE attempt_id = $1 AND is_current', [attemptId]);
    if (!r) throw new AppError('RESULT_PROCESSING', 'Hasil sedang diproses. Muat ulang dalam beberapa detik.');
    if (r.publication_status !== 'PUBLISHED') {
      throw new AppError('RESULT_NOT_PUBLISHED', 'Hasil belum diumumkan.'); // BR-PUB-03: tanpa angka apa pun
    }
    return { a, r };
  }

  /** EP-RES-01 */
  async result(userId: string, attemptId: string) {
    const { a, r } = await this.ownedFinished(userId, attemptId);
    const sections = (await this.db.query(
      'SELECT * FROM result_section_scores WHERE result_id = $1 ORDER BY position', [r.id])).rows;
    const topics = (await this.db.query(
      `SELECT t.*, s.name AS subject_name, tp.name AS topic_name FROM result_topic_scores t
         JOIN subjects s ON s.id = t.subject_id JOIN topics tp ON tp.id = t.topic_id
        WHERE t.result_id = $1 ORDER BY t.accuracy ASC, tp.name`, [r.id])).rows;
    const review = await this.reviewGate(a);
    return {
      attempt: { id: a.id, examId: a.exam_id, examTitle: a.title, examSlug: a.slug, examType: a.exam_type, deliveryMode: a.delivery_mode,
        submissionType: a.submission_type, startedAt: iso(a.started_at), submittedAt: iso(a.submitted_at), attemptNumber: a.attempt_number },
      result: {
        revision: r.revision, isRevised: r.revision > 1, totalScore: Number(r.total_score), totalQuestions: r.total_questions,
        correctCount: r.correct_count, incorrectCount: r.incorrect_count, unansweredCount: r.unanswered_count,
        accuracy: Number(r.accuracy), completionRate: Number(r.completion_rate), durationSeconds: r.duration_seconds,
        publishedAt: iso(r.published_at), disclaimer: SCORE_DISCLAIMER,
      },
      sections: sections.map((s) => {
        const answered = s.correct_count + s.incorrect_count;
        return { name: s.section_name, position: s.position, questionCount: s.question_count, correctCount: s.correct_count,
          incorrectCount: s.incorrect_count, unansweredCount: s.unanswered_count, scaledScore: Number(s.scaled_score),
          accuracy: answered === 0 ? 0 : Math.round((s.correct_count / answered) * 10000) / 10000 };
      }),
      topics: topics.map((t) => ({
        subjectName: t.subject_name, topicName: t.topic_name, questionCount: t.question_count, correctCount: t.correct_count,
        accuracy: Number(t.accuracy), classification: classifyTopic(t.question_count, Number(t.accuracy)),
      })),
      review,
    };
  }

  /** BR-PUB-04: terbit dan, untuk scheduled, now() >= hard_end_at. */
  private async reviewGate(a: any) {
    if (!a.session_id) return { available: true, availableAt: null };
    const s = await this.db.one('SELECT hard_end_at, hard_end_at <= now() AS ok FROM exam_sessions WHERE id = $1', [a.session_id]);
    return { available: !!s?.ok, availableAt: iso(s?.hard_end_at) };
  }

  /** EP-RES-02 */
  async review(userId: string, attemptId: string, filter: string, topicId?: string) {
    const { a } = await this.ownedFinished(userId, attemptId);
    const gate = await this.reviewGate(a);
    if (!gate.available) throw new AppError('REVIEW_NOT_AVAILABLE_YET', 'Pembahasan belum tersedia.');
    const rows = (await this.db.query(
      `SELECT aq.id, aq.position, s.name AS section_name, s.position AS section_position, qv.stem_html, qv.explanation_html,
              aq.question_version_id, COALESCE(eq.scoring_version_id, aq.question_version_id) AS key_version_id,
              eq.scoring_version_id IS NOT NULL AND eq.scoring_version_id <> aq.question_version_id AS is_corrected,
              aa.selected_option_id, COALESCE(aa.is_flagged, FALSE) AS is_flagged, COALESCE(aa.time_spent_ms, 0) AS time_spent_ms,
              tp.name AS topic_name, qv.topic_id
         FROM attempt_questions aq
         JOIN attempt_sections s ON s.id = aq.attempt_section_id
         JOIN exam_questions eq ON eq.id = aq.exam_question_id
         JOIN question_versions qv ON qv.id = aq.question_version_id
         LEFT JOIN topics tp ON tp.id = qv.topic_id
         LEFT JOIN attempt_answers aa ON aa.attempt_question_id = aq.id
        WHERE aq.attempt_id = $1 ORDER BY s.position, aq.position`, [attemptId])).rows;
    const versionIds = [...new Set(rows.flatMap((r) => [r.question_version_id, r.key_version_id]))];
    const opts = (await this.db.query(
      `SELECT id, question_version_id, option_key, content_html, is_correct FROM question_options
        WHERE question_version_id = ANY($1::uuid[]) ORDER BY option_key`, [versionIds])).rows;
    let n = 0;
    const data = rows.map((r) => {
      n += 1;
      const shown = opts.filter((o) => o.question_version_id === r.question_version_id);
      const correctKey = opts.find((o) => o.question_version_id === r.key_version_id && o.is_correct)?.option_key ?? null;
      const selectedKey = shown.find((o) => o.id === r.selected_option_id)?.option_key ?? null;
      const outcome = selectedKey === null ? 'UNANSWERED' : selectedKey === correctKey ? 'CORRECT' : 'INCORRECT';
      return {
        number: n, position: r.position, sectionName: r.section_name, sectionPosition: r.section_position, topicName: r.topic_name,
        stemHtml: r.stem_html, explanationHtml: r.explanation_html,
        options: shown.map((o) => ({ key: o.option_key, contentHtml: o.content_html, isCorrect: o.option_key === correctKey })),
        selectedOptionKey: selectedKey, correctOptionKey: correctKey, outcome, isFlagged: r.is_flagged,
        isCorrected: r.is_corrected, timeSpentMs: Number(r.time_spent_ms), topicId: r.topic_id,
      };
    });
    const filtered = data.filter((d) => (!topicId || d.topicId === topicId)).filter((d) =>
      filter === 'incorrect' ? d.outcome === 'INCORRECT'
        : filter === 'unanswered' ? d.outcome === 'UNANSWERED'
          : filter === 'flagged' ? d.isFlagged : true);
    return { data: filtered, counts: {
      all: data.length, incorrect: data.filter((d) => d.outcome === 'INCORRECT').length,
      unanswered: data.filter((d) => d.outcome === 'UNANSWERED').length, flagged: data.filter((d) => d.isFlagged).length,
    }, exam: { title: a.title } };
  }
}
