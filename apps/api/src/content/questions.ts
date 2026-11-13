import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { versionContentSchema, reviewDecisionSchema, type VersionContentInput, type Role } from '@cogniverse/contracts';
import { AppError, Db, Tx, iso, notFound, parse } from '../common/infra';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { sanitizeRich, plainText } from '../common/sanitize';
import { audit } from '../common/audit';

const isEditor = (r: Role[]) => r.includes('CONTENT_EDITOR') || r.includes('SUPER_ADMIN');
const isExamAdmin = (r: Role[]) => r.includes('EXAM_ADMIN') || r.includes('SUPER_ADMIN');

function versionDto(v: any, options?: any[]) {
  return {
    id: v.id, questionId: v.question_id, versionNumber: v.version_number, status: v.status, authorId: v.author_id,
    authorName: v.author_name, subjectId: v.subject_id, topicId: v.topic_id, difficulty: v.difficulty, cognitiveLevel: v.cognitive_level,
    stemHtml: v.stem_html, explanationHtml: v.explanation_html, correctsVersionId: v.corrects_version_id,
    submittedAt: iso(v.submitted_at), decidedAt: iso(v.decided_at), createdAt: iso(v.created_at), updatedAt: iso(v.updated_at),
    options: options?.map((o) => ({ id: o.id, key: o.option_key, contentHtml: o.content_html, isCorrect: o.is_correct })),
  };
}

/** BR-QV-08: kelengkapan sebelum review. */
function completenessIssues(v: any, options: any[]) {
  const issues: { field: string; issue: string; message: string }[] = [];
  const need = (cond: boolean, field: string, message: string) => { if (!cond) issues.push({ field, issue: 'REQUIRED', message }); };
  need(!!v.subject_id, 'subjectId', 'Subtes wajib dipilih.');
  need(!!v.topic_id, 'topicId', 'Topik wajib dipilih.');
  need(!!v.difficulty, 'difficulty', 'Tingkat kesulitan wajib dipilih.');
  need(!!v.cognitive_level, 'cognitiveLevel', 'Level kognitif wajib dipilih.');
  need(plainText(v.stem_html).length > 0, 'stemHtml', 'Teks soal wajib diisi.');
  need(plainText(v.explanation_html).length > 0, 'explanationHtml', 'Pembahasan wajib diisi.');
  if (options.length < 4 || options.length > 5) issues.push({ field: 'options', issue: 'COUNT', message: 'Soal wajib memiliki 4 atau 5 opsi.' });
  if (options.some((o) => plainText(o.content_html).length === 0 && !/<img/i.test(o.content_html))) {
    issues.push({ field: 'options', issue: 'EMPTY_OPTION', message: 'Setiap opsi wajib berisi teks atau gambar.' });
  }
  if (options.filter((o) => o.is_correct).length !== 1) issues.push({ field: 'options', issue: 'KEY', message: 'Tandai tepat satu opsi sebagai kunci jawaban.' });
  return issues;
}

@Controller()
export class QuestionsController {
  constructor(private db: Db) {}

  /** EP-QST-01 */
  @Get('subjects') @Roles('CONTRIBUTOR', 'CONTENT_EDITOR', 'EXAM_ADMIN')
  async subjects() {
    const s = (await this.db.query('SELECT * FROM subjects WHERE is_active ORDER BY position')).rows;
    const t = (await this.db.query('SELECT * FROM topics WHERE is_active ORDER BY name')).rows;
    return { data: s.map((x) => ({ id: x.id, code: x.code, name: x.name, topics: t.filter((y) => y.subject_id === x.id).map((y) => ({ id: y.id, code: y.code, name: y.name })) })) };
  }

  /** EP-QST-06: CT hanya miliknya; EA hanya versi APPROVED. */
  @Get('questions') @Roles('CONTRIBUTOR', 'CONTENT_EDITOR', 'EXAM_ADMIN')
  async list(@CurrentUser() me: AuthUser, @Query() q: Record<string, string>) {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
    const approvedOnly = !isEditor(me.roles) && isExamAdmin(me.roles) || q.approvedOnly === 'true';
    const ownOnly = !isEditor(me.roles) && !isExamAdmin(me.roles);
    const where = [`TRUE`];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (ownOnly) add('qs.author_id = ?', me.id);
    if (q.q) add(`lv.stem_plain ILIKE '%' || ? || '%'`, q.q);
    if (q.subjectId) add('lv.subject_id = ?', q.subjectId);
    if (q.topicId) add('lv.topic_id = ?', q.topicId);
    if (q.difficulty) add('lv.difficulty = ?', q.difficulty);
    if (q.versionStatus) add('lv.status = ?', q.versionStatus);
    if (approvedOnly) where.push(`av.id IS NOT NULL AND qs.status = 'ACTIVE'`);
    const base = `
      FROM questions qs
      JOIN LATERAL (SELECT * FROM question_versions v WHERE v.question_id = qs.id ORDER BY v.version_number DESC LIMIT 1) lv ON TRUE
      LEFT JOIN LATERAL (SELECT * FROM question_versions v WHERE v.question_id = qs.id AND v.status = 'APPROVED' ORDER BY v.version_number DESC LIMIT 1) av ON TRUE
      LEFT JOIN subjects s ON s.id = COALESCE(av.subject_id, lv.subject_id)
      LEFT JOIN topics t ON t.id = COALESCE(av.topic_id, lv.topic_id)
      JOIN users u ON u.id = qs.author_id
      WHERE ${where.join(' AND ')}`;
    const total = await this.db.one(`SELECT count(*)::int AS n ${base}`, params);
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await this.db.query(
      `SELECT qs.id, qs.status AS question_status, qs.created_at, u.full_name AS author_name, qs.author_id,
              lv.id AS latest_id, lv.version_number AS latest_number, lv.status AS latest_status, lv.stem_plain AS latest_stem, lv.updated_at,
              av.id AS approved_id, av.version_number AS approved_number, av.stem_plain AS approved_stem, av.difficulty AS approved_difficulty,
              s.name AS subject_name, s.code AS subject_code, t.name AS topic_name
       ${base} ORDER BY lv.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return {
      data: rows.rows.map((r) => ({
        id: r.id, status: r.question_status, authorName: r.author_name, isOwn: r.author_id === me.id,
        subjectName: r.subject_name, subjectCode: r.subject_code, topicName: r.topic_name,
        latestVersion: approvedOnly ? null : { id: r.latest_id, versionNumber: r.latest_number, status: r.latest_status, stemPlain: r.latest_stem, updatedAt: iso(r.updated_at) },
        approvedVersion: r.approved_id ? { id: r.approved_id, versionNumber: r.approved_number, stemPlain: r.approved_stem, difficulty: r.approved_difficulty } : null,
      })),
      meta: { page, pageSize, totalItems: total.n, totalPages: Math.ceil(total.n / pageSize) },
    };
  }

  private async saveOptions(c: Tx, versionId: string, input: VersionContentInput) {
    await c.query('DELETE FROM question_options WHERE question_version_id = $1', [versionId]);
    for (const o of input.options) {
      await c.query('INSERT INTO question_options (question_version_id, option_key, content_html, is_correct) VALUES ($1,$2,$3,$4)',
        [versionId, o.key, sanitizeRich(o.contentHtml), o.isCorrect]);
    }
  }

  private async checkTaxonomy(c: Tx, input: VersionContentInput) {
    if (input.topicId && input.subjectId) {
      const t = await this.db.one('SELECT 1 FROM topics WHERE id = $1 AND subject_id = $2', [input.topicId, input.subjectId], c);
      if (!t) throw new AppError('VALIDATION_FAILED', 'Data yang dikirim tidak valid.', [{ field: 'topicId', issue: 'MISMATCH', message: 'Topik tidak termasuk subtes yang dipilih.' }]);
    }
    if (input.options.filter((o) => o.isCorrect).length > 1) {
      throw new AppError('VALIDATION_FAILED', 'Data yang dikirim tidak valid.', [{ field: 'options', issue: 'KEY', message: 'Hanya satu opsi yang boleh menjadi kunci.' }]);
    }
    if (new Set(input.options.map((o) => o.key)).size !== input.options.length) {
      throw new AppError('VALIDATION_FAILED', 'Data yang dikirim tidak valid.', [{ field: 'options', issue: 'DUPLICATE', message: 'Huruf opsi tidak boleh ganda.' }]);
    }
  }

  /** EP-QST-07 */
  @Post('questions') @Roles('CONTRIBUTOR', 'CONTENT_EDITOR')
  async create(@CurrentUser() me: AuthUser, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = parse(versionContentSchema, body);
    const out = await this.db.tx(async (c) => {
      if (!isEditor(me.roles)) {
        const agreed = await this.db.one(`SELECT 1 FROM user_consents WHERE user_id = $1 AND document_type = 'CONTRIBUTOR_AGREEMENT'`, [me.id], c);
        if (!agreed) throw new AppError('CONSENT_REQUIRED', 'Setujui perjanjian kontributor terlebih dahulu.');
      }
      await this.checkTaxonomy(c, input);
      const q = await this.db.one('INSERT INTO questions (author_id) VALUES ($1) RETURNING *', [me.id], c);
      const stem = sanitizeRich(input.stemHtml);
      const v = await this.db.one(
        `INSERT INTO question_versions (question_id, version_number, author_id, subject_id, topic_id, difficulty, cognitive_level,
           stem_html, stem_plain, explanation_html)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [q!.id, me.id, input.subjectId ?? null, input.topicId ?? null, input.difficulty ?? null, input.cognitiveLevel ?? null,
         stem, plainText(stem), sanitizeRich(input.explanationHtml)], c);
      await this.saveOptions(c, v!.id, input);
      return { question: { id: q!.id, status: q!.status }, version: { id: v!.id, status: v!.status } };
    });
    res.status(201);
    return out;
  }

  private async loadVersion(me: AuthUser, versionId: string, c?: Tx, lock = false) {
    const v = await this.db.one(
      `SELECT v.*, u.full_name AS author_name, q.author_id AS question_author, q.status AS question_status
         FROM question_versions v JOIN questions q ON q.id = v.question_id JOIN users u ON u.id = v.author_id
        WHERE v.id = $1 ${lock ? 'FOR UPDATE OF v' : ''}`, [versionId], c);
    if (!v) throw notFound();
    const canSee = isEditor(me.roles) || v.question_author === me.id || (isExamAdmin(me.roles) && v.status === 'APPROVED');
    if (!canSee) throw notFound(); // 404 juga untuk resource milik orang lain (TDD 4.1)
    return v;
  }

  /** EP-QST-08 */
  @Get('questions/:id') @Roles('CONTRIBUTOR', 'CONTENT_EDITOR', 'EXAM_ADMIN')
  async detail(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const q = await this.db.one('SELECT q.*, u.full_name AS author_name FROM questions q JOIN users u ON u.id = q.author_id WHERE q.id = $1', [id]);
    if (!q || (!isEditor(me.roles) && !isExamAdmin(me.roles) && q.author_id !== me.id)) throw notFound();
    const versions = (await this.db.query(
      `SELECT v.*, u.full_name AS author_name FROM question_versions v JOIN users u ON u.id = v.author_id
        WHERE v.question_id = $1 ${!isEditor(me.roles) && q.author_id !== me.id ? `AND v.status = 'APPROVED'` : ''}
        ORDER BY v.version_number DESC`, [id])).rows;
    return {
      question: { id: q.id, status: q.status, authorName: q.author_name, isOwn: q.author_id === me.id, retiredReason: q.retired_reason, createdAt: iso(q.created_at) },
      versions: versions.map((v) => versionDto(v)),
    };
  }

  /** EP-QST-09 */
  @Get('question-versions/:id') @Roles('CONTRIBUTOR', 'CONTENT_EDITOR', 'EXAM_ADMIN')
  async version(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const v = await this.loadVersion(me, id);
    const options = (await this.db.query('SELECT * FROM question_options WHERE question_version_id = $1 ORDER BY option_key', [id])).rows;
    const reviews = (await this.db.query(
      `SELECT r.*, u.full_name AS reviewer_name FROM question_reviews r JOIN users u ON u.id = r.reviewer_id
        WHERE r.question_version_id = $1 ORDER BY r.created_at DESC`, [id])).rows;
    const editable = ['DRAFT', 'CHANGES_REQUESTED'].includes(v.status) && (v.question_author === me.id || isEditor(me.roles)) && v.question_status === 'ACTIVE';
    return {
      version: versionDto(v, options), editable, isOwn: v.question_author === me.id, questionStatus: v.question_status,
      reviews: reviews.map((r) => ({ id: r.id, decision: r.decision, notes: r.notes,
        reviewer: isEditor(me.roles) ? r.reviewer_name : 'Content Editor', createdAt: iso(r.created_at) })),
    };
  }

  /** EP-QST-10 */
  @Put('question-versions/:id') @Roles('CONTRIBUTOR', 'CONTENT_EDITOR')
  async save(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(versionContentSchema, body);
    return this.db.tx(async (c) => {
      const v = await this.loadVersion(me, id, c, true);
      if (v.question_author !== me.id && !isEditor(me.roles)) throw notFound();
      if (!['DRAFT', 'CHANGES_REQUESTED'].includes(v.status)) {
        throw new AppError('VERSION_NOT_EDITABLE', 'Versi soal ini sedang ditinjau atau sudah diputuskan sehingga tidak dapat diubah.');
      }
      if (v.question_status === 'RETIRED') throw new AppError('QUESTION_RETIRED', 'Soal ini sudah di-retire.');
      await this.checkTaxonomy(c, input);
      const stem = sanitizeRich(input.stemHtml);
      await c.query(
        `UPDATE question_versions SET subject_id = $2, topic_id = $3, difficulty = $4, cognitive_level = $5,
           stem_html = $6, stem_plain = $7, explanation_html = $8 WHERE id = $1`,
        [id, input.subjectId ?? null, input.topicId ?? null, input.difficulty ?? null, input.cognitiveLevel ?? null,
         stem, plainText(stem), sanitizeRich(input.explanationHtml)]);
      await this.saveOptions(c, id, input);
      const nv = await this.db.one('SELECT v.*, u.full_name AS author_name FROM question_versions v JOIN users u ON u.id = v.author_id WHERE v.id = $1', [id], c);
      const opts = (await this.db.query('SELECT * FROM question_options WHERE question_version_id = $1 ORDER BY option_key', [id], c)).rows;
      return { version: versionDto(nv, opts) };
    });
  }

  /** EP-QST-11: versi baru dari versi APPROVED terakhir. */
  @Post('questions/:id/versions') @Roles('CONTRIBUTOR', 'CONTENT_EDITOR')
  async newVersion(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() body: any, @Res({ passthrough: true }) res: Response) {
    const out = await this.db.tx(async (c) => {
      const q = await this.db.one('SELECT * FROM questions WHERE id = $1 FOR UPDATE', [id], c);
      if (!q || (q.author_id !== me.id && !isEditor(me.roles))) throw notFound();
      if (q.status === 'RETIRED') throw new AppError('QUESTION_RETIRED', 'Soal ini sudah di-retire.');
      const open = await this.db.one(`SELECT id FROM question_versions WHERE question_id = $1 AND status IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED')`, [id], c);
      if (open) throw new AppError('OPEN_VERSION_EXISTS', 'Soal ini sudah memiliki versi yang belum diputuskan.', [{ field: 'versionId', message: open.id }]);
      const src = await this.db.one(`SELECT * FROM question_versions WHERE question_id = $1 AND status = 'APPROVED' ORDER BY version_number DESC LIMIT 1`, [id], c);
      if (!src) throw new AppError('VERSION_STATUS_CHANGED', 'Belum ada versi yang disetujui untuk dijadikan dasar.');
      const max = await this.db.one('SELECT max(version_number) AS n FROM question_versions WHERE question_id = $1', [id], c);
      const v = await this.db.one(
        `INSERT INTO question_versions (question_id, version_number, author_id, subject_id, topic_id, difficulty, cognitive_level,
           stem_html, stem_plain, explanation_html, corrects_version_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [id, max.n + 1, me.id, src.subject_id, src.topic_id, src.difficulty, src.cognitive_level, src.stem_html, src.stem_plain,
         src.explanation_html, body?.correctsVersionId ?? null], c);
      await c.query(
        `INSERT INTO question_options (question_version_id, option_key, content_html, is_correct)
         SELECT $1, option_key, content_html, is_correct FROM question_options WHERE question_version_id = $2`, [v!.id, src.id]);
      return { version: { id: v!.id, versionNumber: v!.version_number, status: v!.status } };
    });
    res.status(201);
    return out;
  }

  /** EP-QST-12 */
  @Delete('question-versions/:id') @HttpCode(204) @Roles('CONTRIBUTOR', 'CONTENT_EDITOR')
  async remove(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    await this.db.tx(async (c) => {
      const v = await this.loadVersion(me, id, c, true);
      if (v.question_author !== me.id && !isEditor(me.roles)) throw notFound();
      if (v.status !== 'DRAFT' || v.submitted_at) throw new AppError('VERSION_NOT_EDITABLE', 'Hanya draf yang belum pernah diajukan yang dapat dihapus.');
      await c.query('DELETE FROM question_versions WHERE id = $1', [id]);
      const left = await this.db.one('SELECT count(*)::int AS n FROM question_versions WHERE question_id = $1', [v.question_id], c);
      if (left.n === 0) await c.query('DELETE FROM questions WHERE id = $1', [v.question_id]);
    });
  }

  /** EP-QST-13 */
  @Post('questions/:id/retire') @Roles('CONTENT_EDITOR')
  async retire(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() body: any) {
    const reason = String(body?.reason ?? '').trim();
    if (reason.length < 10) throw new AppError('VALIDATION_FAILED', 'Data yang dikirim tidak valid.', [{ field: 'reason', issue: 'TOO_SHORT', message: 'Alasan minimal 10 karakter.' }]);
    return this.db.tx(async (c) => {
      const q = await this.db.one(
        `UPDATE questions SET status = 'RETIRED', retired_at = now(), retired_by = $2, retired_reason = $3
          WHERE id = $1 AND status = 'ACTIVE' RETURNING *`, [id, me.id, reason], c);
      if (!q) throw notFound();
      await audit(c, me, 'QUESTION_RETIRED', 'question', id, null, { status: 'RETIRED' }, reason);
      return { question: { id: q.id, status: q.status } };
    });
  }

  // ------------------------------------------------------------ Review (EP-REV)
  /** EP-REV-01 */
  @Post('question-versions/:id/submit') @HttpCode(200) @Roles('CONTRIBUTOR', 'CONTENT_EDITOR')
  async submit(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.db.tx(async (c) => {
      const v = await this.loadVersion(me, id, c, true);
      if (v.author_id !== me.id && v.question_author !== me.id) throw notFound();
      if (!['DRAFT', 'CHANGES_REQUESTED'].includes(v.status)) throw new AppError('VERSION_STATUS_CHANGED', 'Status versi ini sudah berubah. Muat ulang halaman.');
      const options = (await this.db.query('SELECT * FROM question_options WHERE question_version_id = $1', [id], c)).rows;
      const issues = completenessIssues(v, options);
      if (issues.length) throw new AppError('SUBMISSION_INCOMPLETE', 'Soal belum lengkap untuk diajukan.', issues);
      await c.query(`UPDATE question_versions SET status = 'IN_REVIEW', submitted_at = now() WHERE id = $1`, [id]);
      return { version: { id, status: 'IN_REVIEW' } };
    });
  }

  /** EP-REV-02 */
  @Post('question-versions/:id/withdraw') @HttpCode(200) @Roles('CONTRIBUTOR', 'CONTENT_EDITOR')
  async withdraw(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const r = await this.db.query(
      `UPDATE question_versions SET status = 'DRAFT' WHERE id = $1 AND status = 'IN_REVIEW' AND author_id = $2 RETURNING id`, [id, me.id]);
    if (!r.rowCount) throw new AppError('VERSION_STATUS_CHANGED', 'Versi ini tidak sedang ditinjau.');
    return { version: { id, status: 'DRAFT' } };
  }

  /** EP-REV-03 */
  @Get('reviews/queue') @Roles('CONTENT_EDITOR')
  async queue(@CurrentUser() me: AuthUser) {
    const r = await this.db.query(
      `SELECT v.id, v.question_id, v.version_number, v.stem_plain, v.submitted_at, v.author_id, u.full_name AS author_name,
              s.name AS subject_name, t.name AS topic_name, v.difficulty,
              (SELECT count(*) FROM question_reviews r WHERE r.question_version_id = v.id)::int AS prior_reviews
         FROM question_versions v JOIN users u ON u.id = v.author_id
         LEFT JOIN subjects s ON s.id = v.subject_id LEFT JOIN topics t ON t.id = v.topic_id
        WHERE v.status = 'IN_REVIEW' ORDER BY v.submitted_at`);
    return { data: r.rows.map((x) => ({
      versionId: x.id, questionId: x.question_id, versionNumber: x.version_number, stemPlain: x.stem_plain, submittedAt: iso(x.submitted_at),
      authorName: x.author_name, isOwn: x.author_id === me.id, subjectName: x.subject_name, topicName: x.topic_name,
      difficulty: x.difficulty, isResubmission: x.prior_reviews > 0,
    })) };
  }

  /** EP-REV-04 */
  @Post('question-versions/:id/reviews') @Roles('CONTENT_EDITOR')
  async decide(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = parse(reviewDecisionSchema, body);
    if (input.decision !== 'APPROVED' && !(input.notes && input.notes.length > 0)) {
      throw new AppError('VALIDATION_FAILED', 'Data yang dikirim tidak valid.', [{ field: 'notes', issue: 'REQUIRED', message: 'Catatan wajib diisi untuk keputusan selain menyetujui.' }]);
    }
    const out = await this.db.tx(async (c) => {
      const v = await this.db.one('SELECT * FROM question_versions WHERE id = $1 FOR UPDATE', [id], c);
      if (!v) throw notFound();
      if (v.author_id === me.id) throw new AppError('SELF_REVIEW_FORBIDDEN', 'Anda tidak dapat memutuskan review atas soal yang Anda tulis sendiri.');
      if (v.status !== input.expectedStatus) throw new AppError('VERSION_STATUS_CHANGED', 'Status versi ini sudah berubah. Muat ulang halaman.');
      if (input.decision === 'APPROVED') {
        const ok = await this.db.one(
          `SELECT 1 FROM subjects s JOIN topics t ON t.subject_id = s.id WHERE s.id = $1 AND t.id = $2 AND s.is_active AND t.is_active`,
          [v.subject_id, v.topic_id], c);
        if (!ok) throw new AppError('VALIDATION_FAILED', 'Subtes atau topik soal ini sudah tidak aktif.');
      }
      const review = await this.db.one(
        `INSERT INTO question_reviews (question_version_id, reviewer_id, decision, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
        [id, me.id, input.decision, input.notes || null], c);
      if (input.decision === 'CHANGES_REQUESTED') {
        await c.query(`UPDATE question_versions SET status = 'CHANGES_REQUESTED' WHERE id = $1`, [id]);
      } else {
        await c.query(`UPDATE question_versions SET status = $2, decided_at = now(), decided_by = $3 WHERE id = $1`, [id, input.decision, me.id]);
      }
      await audit(c, me, `QUESTION_REVIEW_${input.decision}`, 'question_version', id, { status: 'IN_REVIEW' }, { status: input.decision }, input.notes ?? null);
      return { review: { id: review!.id, decision: review!.decision, notes: review!.notes, createdAt: iso(review!.created_at) }, version: { id, status: input.decision } };
    });
    res.status(201);
    return out;
  }
}
