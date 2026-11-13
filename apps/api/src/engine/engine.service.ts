import { Injectable, Logger } from '@nestjs/common';
import crypto from 'node:crypto';
import type { AttemptStateDto, SaveAnswerInput } from '@cogniverse/contracts';
import { AppError, Db, Tx, config, iso, notFound, randomToken, sha256 } from '../common/infra';
import { ScoringService } from '../scoring/scoring.service';

/**
 * ExamEngine (TDD 2.6, 6.1–6.3). Satu proses untuk on-demand dan scheduled.
 * Mode scheduled (enrollment/session) belum diaktifkan pada tonggak ini; cabangnya
 * menolak dengan NOT_ENROLLED sampai modul Sessions dibangun.
 */
@Injectable()
export class EngineService {
  private log = new Logger('Engine');
  constructor(private db: Db, private scoring: ScoringService) {}

  // ------------------------------------------------------------------ 6.3.2
  async reconcileSections(c: Tx, attemptId: string) {
    for (let i = 0; i < 50; i++) {
      const cur = await this.db.one(
        `SELECT id, deadline_at, deadline_at <= now() AS due FROM attempt_sections
          WHERE attempt_id = $1 AND status = 'ACTIVE' ORDER BY position LIMIT 1`, [attemptId], c);
      if (!cur || !cur.due) return;
      const a = await this.db.one('SELECT timing_mode FROM exam_attempts WHERE id = $1', [attemptId], c);
      if (a.timing_mode === 'TOTAL') return; // TOTAL: tidak berubah sampai tenggat akhir (6.3.2)
      await c.query(
        `UPDATE attempt_sections SET status = 'ENDED', ended_at = deadline_at, end_reason = 'TIMEOUT' WHERE id = $1`, [cur.id]);
      const next = await this.db.one(
        `SELECT id FROM attempt_sections WHERE attempt_id = $1 AND status = 'PENDING' ORDER BY position LIMIT 1`, [attemptId], c);
      if (!next) return;
      await c.query(
        `UPDATE attempt_sections SET status = 'ACTIVE', started_at = $2,
                deadline_at = $2::timestamptz + make_interval(secs => duration_seconds) WHERE id = $1`, [next.id, cur.deadline_at]);
    }
  }

  // ------------------------------------------------------------------ 6.3.4
  /** Mengumpulkan attempt yang melewati expires_at + grace. Mengembalikan true bila attempt difinalisasi. */
  private async finalizeIfExpired(c: Tx, a: any): Promise<boolean> {
    await this.reconcileSections(c, a.id);
    const due = await this.db.one(
      `SELECT expires_at, now() >= expires_at + make_interval(secs => $2) AS due FROM exam_attempts WHERE id = $1`,
      [a.id, config.graceSeconds], c);
    if (!due.due) return false;
    await c.query(
      `UPDATE attempt_sections SET status = 'ENDED', ended_at = COALESCE(deadline_at, now()), end_reason = 'TIMEOUT',
              started_at = COALESCE(started_at, deadline_at, now()), deadline_at = COALESCE(deadline_at, now())
        WHERE attempt_id = $1 AND status <> 'ENDED'`, [a.id]);
    await c.query(
      `UPDATE exam_attempts SET status = 'SUBMITTED', submission_type = 'AUTO_TIMEOUT', submitted_at = expires_at
        WHERE id = $1 AND status = 'IN_PROGRESS'`, [a.id]);
    return true;
  }

  async finalizeExpiredAttempt(attemptId: string) {
    const done = await this.db.tx(async (c) => {
      const a = await this.db.one('SELECT * FROM exam_attempts WHERE id = $1 FOR UPDATE', [attemptId], c);
      if (!a || a.status !== 'IN_PROGRESS') return false;
      return this.finalizeIfExpired(c, a);
    });
    if (done) await this.scoring.scoreSafely(attemptId);
  }

  /** Sweeper (TDD 6.3.4): jaring pengaman auto-submit dan scoring yang tertunda. */
  async sweep() {
    const due = await this.db.query(
      `SELECT id FROM exam_attempts WHERE status = 'IN_PROGRESS' AND expires_at + make_interval(secs => $1) <= now() LIMIT 500`,
      [config.graceSeconds]);
    for (const r of due.rows) await this.finalizeExpiredAttempt(r.id).catch((e) => this.log.error(e));
    const unscored = await this.db.query(
      `SELECT id FROM exam_attempts WHERE status = 'SUBMITTED' AND submitted_at <= now() - interval '30 seconds' LIMIT 100`);
    for (const r of unscored.rows) await this.scoring.scoreSafely(r.id);
  }

  // ------------------------------------------------------------------ helpers
  private async loadExam(c: Tx | undefined, examId: string) {
    const e = await this.db.one(
      `SELECT e.*, now() BETWEEN e.available_from AND e.available_until AS in_window FROM exams e WHERE e.id = $1`, [examId], c);
    if (!e) throw notFound();
    const sections = await this.db.query(
      `SELECT s.*, (SELECT count(*) FROM exam_questions q WHERE q.exam_section_id = s.id)::int AS question_count
         FROM exam_sections s WHERE s.exam_id = $1 ORDER BY s.position`, [examId], c);
    return { exam: e, sections: sections.rows };
  }

  private totalSeconds(exam: any, sections: any[]) {
    return exam.timing_mode === 'TOTAL'
      ? exam.duration_minutes * 60
      : sections.reduce((s, x) => s + (x.duration_minutes ?? 0) * 60, 0);
  }

  /** Langkah 3–5 TDD 6.1 tanpa efek samping; melempar AppError dengan kode alasan. */
  private async checkStart(c: Tx | undefined, userId: string, examId: string, lock: boolean) {
    const ent = await this.db.one(
      `SELECT * FROM entitlements WHERE user_id = $1 AND exam_id = $2 AND status = 'ACTIVE'
          AND valid_until >= now() AND attempts_used < max_attempts
        ORDER BY valid_until ASC LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`, [userId, examId], c);
    if (!ent) {
      const any = await this.db.query(
        `SELECT status, valid_until < now() AS expired, attempts_used >= max_attempts AS used_up FROM entitlements
          WHERE user_id = $1 AND exam_id = $2`, [userId, examId], c);
      if (any.rows.length === 0 || any.rows.every((r) => r.status === 'REVOKED')) {
        throw new AppError('NO_ENTITLEMENT', 'Kamu belum memiliki akses ke ujian ini.');
      }
      if (any.rows.some((r) => r.status === 'ACTIVE' && !r.used_up)) {
        throw new AppError('ENTITLEMENT_EXPIRED', 'Masa akses ujian ini sudah berakhir.');
      }
      throw new AppError('ATTEMPT_LIMIT_REACHED', 'Kesempatan mengerjakan ujian ini sudah habis.');
    }
    const { exam, sections } = await this.loadExam(c, examId);
    if (!['PUBLISHED', 'UNPUBLISHED'].includes(exam.status) || !exam.in_window) {
      throw new AppError('EXAM_NOT_AVAILABLE', 'Ujian ini sedang tidak tersedia.');
    }
    if (exam.delivery_mode === 'SCHEDULED') {
      throw new AppError('NOT_ENROLLED', 'Kamu belum terdaftar pada sesi ujian ini.');
    }
    return { ent, exam, sections };
  }

  // ------------------------------------------------------------------ EP-ATT-01
  async eligibility(userId: string, examId: string) {
    const { exam, sections } = await this.loadExam(undefined, examId);
    const now = await this.db.one('SELECT now() AS now');
    let eligibility: any = { canStart: true };
    const inProgress = await this.db.one(
      `SELECT id, exam_id FROM exam_attempts WHERE user_id = $1 AND status = 'IN_PROGRESS'`, [userId]);
    if (inProgress?.exam_id === examId) eligibility = { canStart: true, resumableAttemptId: inProgress.id };
    else if (inProgress) eligibility = { canStart: false, reasonCode: 'ANOTHER_ATTEMPT_IN_PROGRESS', resumableAttemptId: inProgress.id, resumableExamId: inProgress.exam_id };
    else {
      try { await this.checkStart(undefined, userId, examId, false); } catch (e) {
        if (e instanceof AppError) eligibility = { canStart: false, reasonCode: e.code, message: e.message };
        else throw e;
      }
    }
    const ent = await this.db.one(
      `SELECT max_attempts - attempts_used AS remaining, valid_until FROM entitlements
        WHERE user_id = $1 AND exam_id = $2 AND status = 'ACTIVE' ORDER BY valid_until DESC LIMIT 1`, [userId, examId]);
    return {
      exam: {
        id: exam.id, title: exam.title, examType: exam.exam_type, deliveryMode: exam.delivery_mode, timingMode: exam.timing_mode,
        instructionsHtml: exam.instructions_html,
        totalQuestions: sections.reduce((s, x) => s + x.question_count, 0),
        totalDurationSeconds: this.totalSeconds(exam, sections),
        sections: sections.map((s) => ({ name: s.name, position: s.position, questionCount: s.question_count, durationSeconds: s.duration_minutes ? s.duration_minutes * 60 : null })),
      },
      eligibility: { ...eligibility, attemptsRemaining: ent ? Number(ent.remaining) : 0, validUntil: iso(ent?.valid_until) },
      serverTime: iso(now.now),
    };
  }

  // ------------------------------------------------------------------ EP-ATT-02 (TDD 6.1)
  async startOrResume(userId: string, examId: string, retry = true): Promise<{ created: boolean; body: any }> {
    const toScore: string[] = [];
    try {
      const out = await this.db.tx(async (c) => {
        const existing = await this.db.one(
          `SELECT * FROM exam_attempts WHERE user_id = $1 AND status = 'IN_PROGRESS' FOR UPDATE`, [userId], c);
        if (existing) {
          const finalized = await this.finalizeIfExpired(c, existing);
          if (finalized) toScore.push(existing.id);
          else if (existing.exam_id === examId) {
            const token = randomToken();
            await c.query(
              `UPDATE exam_attempts SET client_session_hash = $2, client_session_started_at = now() WHERE id = $1`,
              [existing.id, sha256(token)]);
            return { created: false, body: await this.attemptSummary(c, existing.id, token) };
          } else {
            throw new AppError('ANOTHER_ATTEMPT_IN_PROGRESS', 'Kamu masih memiliki ujian lain yang sedang berlangsung.',
              [{ field: 'attemptId', issue: 'IN_PROGRESS', message: existing.id }]);
          }
        }
        const { ent, exam, sections } = await this.checkStart(c, userId, examId, true);
        const total = this.totalSeconds(exam, sections);
        const totalQuestions = sections.reduce((s, x) => s + x.question_count, 0);
        const token = randomToken();
        const attemptId = crypto.randomUUID();
        await c.query(
          `INSERT INTO exam_attempts (id, user_id, exam_id, entitlement_id, attempt_number, timing_mode, total_questions,
             started_at, expires_at, client_session_hash, client_session_started_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now() + make_interval(secs => $8), $9, now())`,
          [attemptId, userId, examId, ent.id, ent.attempts_used + 1, exam.timing_mode, totalQuestions, total, sha256(token)]);
        for (const [i, s] of sections.entries()) {
          const dur = exam.timing_mode === 'TOTAL' ? total : s.duration_minutes * 60;
          const active = exam.timing_mode === 'TOTAL' || i === 0;
          await c.query(
            `INSERT INTO attempt_sections (attempt_id, exam_section_id, name, position, duration_seconds, question_count,
               status, started_at, deadline_at)
             VALUES ($1,$2,$3,$4,$5::int,$6,$7, CASE WHEN $8 THEN now() END,
                     CASE WHEN $8 THEN now() + make_interval(secs => $5::int) END)`,
            [attemptId, s.id, s.name, s.position, dur, s.question_count, active ? 'ACTIVE' : 'PENDING', active]);
        }
        // Snapshot soal (BR-LIF-02); versi koreksi dipakai bila ada (EC-13)
        await c.query(
          `INSERT INTO attempt_questions (attempt_id, attempt_section_id, exam_question_id, question_version_id, position, weight)
           SELECT $1, ast.id, eq.id, COALESCE(eq.scoring_version_id, eq.question_version_id), eq.position, eq.weight
             FROM exam_questions eq JOIN attempt_sections ast ON ast.exam_section_id = eq.exam_section_id AND ast.attempt_id = $1
            WHERE eq.exam_id = $2`, [attemptId, examId]);
        await c.query('UPDATE entitlements SET attempts_used = attempts_used + 1 WHERE id = $1', [ent.id]); // BR-ATT-02
        return { created: true, body: await this.attemptSummary(c, attemptId, token) };
      });
      return out;
    } catch (e: any) {
      if (e?.code === '23505' && e?.constraint === 'exam_attempts_one_in_progress_idx' && retry) {
        return this.startOrResume(userId, examId, false); // EC-05: permintaan bersamaan
      }
      throw e;
    } finally {
      for (const id of toScore) await this.scoring.scoreSafely(id);
    }
  }

  private async attemptSummary(c: Tx, attemptId: string, token: string) {
    const a = await this.db.one(`SELECT a.*, now() AS server_now FROM exam_attempts a WHERE a.id = $1`, [attemptId], c);
    const s = await this.db.one(
      `SELECT id, deadline_at FROM attempt_sections WHERE attempt_id = $1 AND status = 'ACTIVE' ORDER BY position LIMIT 1`, [attemptId], c);
    return {
      attempt: {
        id: a.id, examId: a.exam_id, status: a.status, timingMode: a.timing_mode, attemptNumber: a.attempt_number,
        startedAt: iso(a.started_at), expiresAt: iso(a.expires_at), activeSectionId: s?.id ?? null, sectionDeadlineAt: iso(s?.deadline_at),
      },
      sessionToken: token,
      serverTime: iso(a.server_now),
    };
  }

  /** Mengunci attempt milik pengguna dan memeriksa sesi perangkat; menjalankan rekonsiliasi. */
  private async lockOwned(c: Tx, attemptId: string, userId: string, sessionToken?: string) {
    const a = await this.db.one('SELECT * FROM exam_attempts WHERE id = $1 AND user_id = $2 FOR UPDATE', [attemptId, userId], c);
    if (!a) throw notFound();
    if (a.status === 'VOIDED') throw new AppError('ATTEMPT_VOIDED', 'Pengerjaan ini dibatalkan oleh admin.');
    if (a.status !== 'IN_PROGRESS') throw new AppError('ATTEMPT_NOT_IN_PROGRESS', 'Ujian ini sudah dikumpulkan.');
    if (sessionToken !== undefined && a.client_session_hash !== sha256(sessionToken)) {
      throw new AppError('ATTEMPT_SESSION_TAKEN_OVER', 'Ujian ini sedang dibuka di perangkat atau tab lain.');
    }
    return a;
  }

  // ------------------------------------------------------------------ EP-ATT-03
  async state(userId: string, attemptId: string, sessionToken: string): Promise<AttemptStateDto> {
    let expired = false;
    const out = await this.db.tx(async (c) => {
      const a = await this.lockOwned(c, attemptId, userId, sessionToken);
      if (await this.finalizeIfExpired(c, a)) { expired = true; return null; }
      const exam = await this.db.one('SELECT title FROM exams WHERE id = $1', [a.exam_id], c);
      const sections = (await this.db.query(
        `SELECT * FROM attempt_sections WHERE attempt_id = $1 ORDER BY position`, [attemptId], c)).rows;
      // PER_SECTION: hanya soal section ACTIVE yang dikirim (FR-ENG-10)
      const visible = a.timing_mode === 'TOTAL' ? sections.map((s) => s.id) : sections.filter((s) => s.status === 'ACTIVE').map((s) => s.id);
      const offsets = new Map<string, number>();
      let acc = 0;
      for (const s of sections) { offsets.set(s.id, acc); acc += s.question_count; }
      const qs = (await this.db.query(
        `SELECT aq.id, aq.attempt_section_id, aq.position, qv.stem_html, aq.question_version_id
           FROM attempt_questions aq JOIN question_versions qv ON qv.id = aq.question_version_id
          WHERE aq.attempt_id = $1 AND aq.attempt_section_id = ANY($2::uuid[])`, [attemptId, visible], c)).rows;
      // FR-ENG-11: is_correct dan explanation_html tidak pernah dipilih di sini
      const opts = (await this.db.query(
        `SELECT id, question_version_id, option_key, content_html FROM question_options
          WHERE question_version_id = ANY($1::uuid[]) ORDER BY option_key`, [qs.map((q) => q.question_version_id)], c)).rows;
      const answers = (await this.db.query(
        `SELECT attempt_question_id, selected_option_id, is_flagged, client_seq FROM attempt_answers WHERE attempt_id = $1`, [attemptId], c)).rows;
      const now = await this.db.one('SELECT now() AS now', [], c);
      const sectionPos = new Map(sections.map((s) => [s.id, s.position]));
      return {
        attempt: { id: a.id, examId: a.exam_id, examTitle: exam.title, status: a.status, timingMode: a.timing_mode, expiresAt: iso(a.expires_at)!, totalQuestions: a.total_questions },
        sections: sections.map((s) => ({
          id: s.id, name: s.name, position: s.position, status: s.status, durationSeconds: s.duration_seconds,
          questionCount: s.question_count, startedAt: iso(s.started_at), deadlineAt: iso(s.deadline_at),
        })),
        questions: qs
          .sort((x, y) => sectionPos.get(x.attempt_section_id)! - sectionPos.get(y.attempt_section_id)! || x.position - y.position)
          .map((q) => ({
            id: q.id, sectionId: q.attempt_section_id, position: q.position, number: offsets.get(q.attempt_section_id)! + q.position,
            stemHtml: q.stem_html,
            options: opts.filter((o) => o.question_version_id === q.question_version_id).map((o) => ({ id: o.id, key: o.option_key, contentHtml: o.content_html })),
          })),
        answers: answers.map((x) => ({ questionId: x.attempt_question_id, selectedOptionId: x.selected_option_id, isFlagged: x.is_flagged, clientSeq: Number(x.client_seq) })),
        serverTime: iso(now.now)!,
      };
    });
    if (expired) {
      await this.scoring.scoreSafely(attemptId);
      throw new AppError('ATTEMPT_NOT_IN_PROGRESS', 'Waktu ujian telah habis dan jawabanmu sudah dikumpulkan otomatis.');
    }
    return out!;
  }

  // ------------------------------------------------------------------ EP-ATT-04
  async status(userId: string, attemptId: string) {
    let finalized = false;
    const out = await this.db.tx(async (c) => {
      const a = await this.db.one('SELECT * FROM exam_attempts WHERE id = $1 AND user_id = $2 FOR UPDATE', [attemptId, userId], c);
      if (!a) throw notFound();
      if (a.status === 'IN_PROGRESS') finalized = await this.finalizeIfExpired(c, a);
      const cur = await this.db.one('SELECT status, expires_at, now() AS now FROM exam_attempts WHERE id = $1', [attemptId], c);
      const s = await this.db.one(
        `SELECT id, deadline_at FROM attempt_sections WHERE attempt_id = $1 AND status = 'ACTIVE' ORDER BY position LIMIT 1`, [attemptId], c);
      return { status: cur.status, examId: a.exam_id, activeSectionId: s?.id ?? null, sectionDeadlineAt: iso(s?.deadline_at), expiresAt: iso(cur.expires_at), serverTime: iso(cur.now) };
    });
    if (finalized) await this.scoring.scoreSafely(attemptId);
    return out;
  }

  // ------------------------------------------------------------------ EP-ATT-05 (BR-SUB-06)
  async endSection(userId: string, attemptId: string, sectionId: string, sessionToken: string) {
    let submitted = false;
    await this.db.tx(async (c) => {
      const a = await this.lockOwned(c, attemptId, userId, sessionToken);
      if (await this.finalizeIfExpired(c, a)) { submitted = true; return; }
      if (a.timing_mode !== 'PER_SECTION') throw new AppError('SECTION_NOT_ACTIVE', 'Subtes tidak dapat diakhiri pada mode ini.');
      const s = await this.db.one('SELECT * FROM attempt_sections WHERE id = $1 AND attempt_id = $2', [sectionId, attemptId], c);
      if (!s) throw notFound();
      if (s.status === 'ENDED') return; // idempotent
      if (s.status !== 'ACTIVE') throw new AppError('SECTION_NOT_ACTIVE', 'Subtes ini belum dimulai.');
      await c.query(`UPDATE attempt_sections SET status = 'ENDED', ended_at = now(), end_reason = 'MANUAL' WHERE id = $1`, [s.id]);
      const next = await this.db.one(
        `SELECT id FROM attempt_sections WHERE attempt_id = $1 AND status = 'PENDING' ORDER BY position LIMIT 1`, [attemptId], c);
      if (!next) {
        await c.query(
          `UPDATE exam_attempts SET status = 'SUBMITTED', submission_type = 'MANUAL', submitted_at = LEAST(now(), expires_at) WHERE id = $1`, [attemptId]);
        submitted = true;
        return;
      }
      await c.query(
        `UPDATE attempt_sections SET status = 'ACTIVE', started_at = now(), deadline_at = now() + make_interval(secs => duration_seconds) WHERE id = $1`, [next.id]);
      // sisa waktu tidak dibawa (BR-DUR-03)
      await c.query(
        `UPDATE exam_attempts SET expires_at = now() + make_interval(secs => (
            SELECT sum(duration_seconds) FROM attempt_sections WHERE attempt_id = $1 AND status IN ('ACTIVE','PENDING')))
          WHERE id = $1`, [attemptId]);
    });
    if (submitted) await this.scoring.scoreSafely(attemptId);
    return { submitted };
  }

  // ------------------------------------------------------------------ EP-ATT-06 (TDD 6.3.5)
  async submit(userId: string, attemptId: string) {
    const r = await this.db.tx(async (c) => {
      const a = await this.db.one('SELECT * FROM exam_attempts WHERE id = $1 AND user_id = $2 FOR UPDATE', [attemptId, userId], c);
      if (!a) throw notFound();
      if (a.status === 'VOIDED') throw new AppError('ATTEMPT_VOIDED', 'Pengerjaan ini dibatalkan oleh admin.');
      if (a.status === 'IN_PROGRESS') {
        await this.reconcileSections(c, a.id);
        const t = await this.db.one(`SELECT now() >= expires_at AS late FROM exam_attempts WHERE id = $1`, [a.id], c);
        await c.query(
          `UPDATE attempt_sections SET status = 'ENDED', ended_at = LEAST(now(), COALESCE(deadline_at, now())),
                  end_reason = $2, started_at = COALESCE(started_at, now()), deadline_at = COALESCE(deadline_at, now())
            WHERE attempt_id = $1 AND status <> 'ENDED'`, [a.id, t.late ? 'TIMEOUT' : 'ATTEMPT_SUBMITTED']);
        await c.query(
          `UPDATE exam_attempts SET status = 'SUBMITTED', submission_type = $2, submitted_at = LEAST(now(), expires_at) WHERE id = $1`,
          [a.id, t.late ? 'AUTO_TIMEOUT' : 'MANUAL']);
      }
      return this.db.one('SELECT status, submission_type, submitted_at FROM exam_attempts WHERE id = $1', [a.id], c);
    });
    if (r.status === 'SUBMITTED') await this.scoring.scoreSafely(attemptId);
    const cur = await this.db.one('SELECT status, submission_type, submitted_at FROM exam_attempts WHERE id = $1', [attemptId]);
    return {
      attempt: { status: cur.status, submissionType: cur.submission_type, submittedAt: iso(cur.submitted_at) },
      resultAvailability: cur.status === 'SCORED' ? 'AVAILABLE' : 'PROCESSING',
    };
  }

  // ------------------------------------------------------------------ EP-ANS-01 (TDD 6.2)
  async saveAnswer(userId: string, attemptId: string, attemptQuestionId: string, sessionToken: string, input: SaveAnswerInput) {
    const params = [crypto.randomUUID(), attemptId, attemptQuestionId, input.selectedOptionId, input.isFlagged,
      input.clientSeq, input.timeSpentMs, userId, sha256(sessionToken ?? ''), config.graceSeconds];
    const r = await this.db.query(
      `INSERT INTO attempt_answers
         (id, attempt_id, attempt_question_id, selected_option_id, first_selected_option_id, is_flagged, client_seq, time_spent_ms, answered_at, saved_at)
       SELECT $1, a.id, aq.id, $4::uuid, $4::uuid, $5, $6, $7, CASE WHEN $4::uuid IS NULL THEN NULL ELSE now() END, now()
         FROM exam_attempts a
         JOIN attempt_questions aq ON aq.attempt_id = a.id AND aq.id = $3
         JOIN attempt_sections s ON s.id = aq.attempt_section_id
        WHERE a.id = $2 AND a.user_id = $8 AND a.status = 'IN_PROGRESS' AND a.client_session_hash = $9
          AND (s.status = 'ACTIVE' OR (s.status = 'ENDED' AND s.end_reason = 'TIMEOUT'))
          AND now() <= s.deadline_at + make_interval(secs => $10)
          AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM question_options o WHERE o.id = $4::uuid AND o.question_version_id = aq.question_version_id))
       ON CONFLICT (attempt_question_id) DO UPDATE
         SET selected_option_id = EXCLUDED.selected_option_id, is_flagged = EXCLUDED.is_flagged, client_seq = EXCLUDED.client_seq,
             first_selected_option_id = COALESCE(attempt_answers.first_selected_option_id, EXCLUDED.selected_option_id),
             answer_change_count = attempt_answers.answer_change_count
               + CASE WHEN attempt_answers.selected_option_id IS NOT NULL AND EXCLUDED.selected_option_id IS NOT NULL
                       AND attempt_answers.selected_option_id <> EXCLUDED.selected_option_id THEN 1 ELSE 0 END,
             time_spent_ms = GREATEST(attempt_answers.time_spent_ms, EXCLUDED.time_spent_ms),
             answered_at = EXCLUDED.answered_at, saved_at = now()
         WHERE attempt_answers.client_seq < EXCLUDED.client_seq
       RETURNING client_seq, saved_at, now() AS server_now`, params);
    if (r.rowCount === 1) {
      const x = r.rows[0];
      return { saved: true, questionId: attemptQuestionId, clientSeq: Number(x.client_seq), savedAt: iso(x.saved_at), serverTime: iso(x.server_now) };
    }
    // Diagnosa hanya pada jalur 0 baris
    const d = await this.db.one(
      `SELECT a.user_id, a.status, a.client_session_hash = $3 AS same_session,
              aq.id AS aq_id, s.status AS s_status, s.end_reason,
              now() > s.deadline_at + make_interval(secs => $4) AS past,
              ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM question_options o WHERE o.id = $5::uuid AND o.question_version_id = aq.question_version_id)) AS option_ok,
              aa.client_seq AS stored_seq, aa.saved_at, now() AS server_now
         FROM exam_attempts a
         LEFT JOIN attempt_questions aq ON aq.attempt_id = a.id AND aq.id = $2
         LEFT JOIN attempt_sections s ON s.id = aq.attempt_section_id
         LEFT JOIN attempt_answers aa ON aa.attempt_question_id = aq.id
        WHERE a.id = $1`, [attemptId, attemptQuestionId, sha256(sessionToken ?? ''), config.graceSeconds, input.selectedOptionId]);
    if (!d || d.user_id !== userId) throw notFound();
    if (d.status !== 'IN_PROGRESS') throw new AppError('ATTEMPT_NOT_IN_PROGRESS', 'Ujian ini sudah dikumpulkan.');
    if (!d.same_session) throw new AppError('ATTEMPT_SESSION_TAKEN_OVER', 'Ujian ini sedang dibuka di perangkat atau tab lain.');
    if (!d.aq_id) throw new AppError('QUESTION_NOT_IN_ATTEMPT', 'Soal ini bukan bagian dari ujianmu.');
    if (d.past) throw new AppError('ATTEMPT_EXPIRED', 'Waktu ujian telah habis. Jawaban ini tidak dapat disimpan.');
    if (d.s_status === 'PENDING' || (d.s_status === 'ENDED' && d.end_reason !== 'TIMEOUT')) {
      throw new AppError('SECTION_NOT_ACTIVE', 'Subtes ini sudah berakhir atau belum dimulai.');
    }
    if (!d.option_ok) throw new AppError('INVALID_OPTION', 'Pilihan jawaban tidak valid.');
    return { saved: false, questionId: attemptQuestionId, clientSeq: Number(d.stored_seq ?? input.clientSeq), savedAt: iso(d.saved_at), serverTime: iso(d.server_now) };
  }

  // ------------------------------------------------------------------ EP-ATT-07
  async history(userId: string) {
    const r = await this.db.query(
      `SELECT a.id, a.status, a.submission_type, a.started_at, a.submitted_at, a.attempt_number,
              e.title, e.exam_type, e.delivery_mode, e.slug, e.series_id, sr.name AS series_name,
              res.total_score, res.publication_status
         FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
         LEFT JOIN exam_series sr ON sr.id = e.series_id
         LEFT JOIN exam_results res ON res.attempt_id = a.id AND res.is_current
        WHERE a.user_id = $1 ORDER BY a.started_at DESC`, [userId]);
    return r.rows.map((x) => ({
      id: x.id, status: x.status, submissionType: x.submission_type, startedAt: iso(x.started_at), submittedAt: iso(x.submitted_at),
      attemptNumber: x.attempt_number,
      exam: { title: x.title, examType: x.exam_type, deliveryMode: x.delivery_mode, slug: x.slug },
      series: x.series_id ? { id: x.series_id, name: x.series_name } : null,
      totalScore: x.publication_status === 'PUBLISHED' ? Math.round(Number(x.total_score)) : null,
    }));
  }
}
