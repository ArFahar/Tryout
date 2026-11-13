import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Res } from '@nestjs/common';
import { Response } from 'express';
import crypto from 'node:crypto';
import { createExamSchema, updateExamSchema, sectionsSchema, sectionQuestionsSchema, createSeriesSchema, publishSchema } from '@cogniverse/contracts';
import { Settings } from '../common/settings';
import { AppError, Db, Tx, iso, notFound, parse, ErrorDetail } from '../common/infra';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { sanitizeRich } from '../common/sanitize';
import { audit } from '../common/audit';

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60);

@Controller('admin/exams') @Roles('EXAM_ADMIN')
export class ExamsAdminController {
  constructor(private db: Db, private settings: Settings) {}

  /** EP-EXM-03 */
  @Get()
  async list() {
    const r = await this.db.query(
      `SELECT e.*, (SELECT count(*) FROM exam_questions q WHERE q.exam_id = e.id)::int AS question_count,
              (SELECT count(*) FROM entitlements x WHERE x.exam_id = e.id)::int AS entitlement_count,
              (SELECT count(*) FROM exam_attempts a WHERE a.exam_id = e.id)::int AS attempt_count,
              sr.name AS series_name
         FROM exams e
         LEFT JOIN exam_series sr ON sr.id = e.series_id
        ORDER BY e.updated_at DESC`);
    return { data: r.rows.map((e) => ({
      id: e.id, title: e.title, slug: e.slug, examType: e.exam_type, deliveryMode: e.delivery_mode, timingMode: e.timing_mode,
      status: e.status, seriesName: e.series_name, questionCount: e.question_count, entitlementCount: e.entitlement_count, attemptCount: e.attempt_count,
      updatedAt: iso(e.updated_at),
      availableFrom: iso(e.available_from), availableUntil: iso(e.available_until),
    })) };
  }

  /** EP-EXM-04 (v3.0): exam DRAFT bertipe FULL_TRYOUT; akses lewat paket, tanpa product per exam. */
  @Post()
  async create(@CurrentUser() me: AuthUser, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = parse(createExamSchema, body);
    const out = await this.db.tx(async (c) => {
      const slug = `${slugify(input.title)}-${crypto.randomBytes(3).toString('hex')}`;
      if (input.seriesId) await this.assertSeriesType(c, input.seriesId, input.examType);
      const maxAttempts = 1;
      const e = await this.db.one(
        `INSERT INTO exams (slug, title, description, exam_type, delivery_mode, timing_mode, max_attempts, created_by, series_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [slug, input.title, input.description, input.examType, input.deliveryMode, input.timingMode, maxAttempts, me.id, input.seriesId ?? null], c);
      await c.query(`INSERT INTO exam_sections (exam_id, name, position) VALUES ($1, 'Subtes 1', 1)`, [e!.id]);
      return { exam: { id: e!.id } };
    });
    res.status(201);
    return out;
  }

  private async load(c: Tx | undefined, id: string, lock = false) {
    const e = await this.db.one(`SELECT * FROM exams WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id], c);
    if (!e) throw notFound();
    return e;
  }

  private async assertSeriesType(c: Tx, seriesId: string, examType: string) {
    const s = await this.db.one(`SELECT exam_type, status FROM exam_series WHERE id = $1`, [seriesId], c);
    if (!s) throw notFound();
    if (s.exam_type !== examType) throw new AppError('SERIES_TYPE_MISMATCH', 'Seri ini untuk tipe try out lain.');
    if (s.status !== 'ACTIVE') throw new AppError('SERIES_LOCKED', 'Seri ini sudah diarsipkan.');
  }

  /** FR-QV-05 / EP-EXM-07: struktur terkunci setelah terbit atau bila sudah ada entitlement. */
  private async assertStructureEditable(c: Tx, e: any) {
    const ents = await this.db.one('SELECT count(*)::int AS n FROM entitlements WHERE exam_id = $1', [e.id], c);
    if (!['DRAFT', 'UNPUBLISHED'].includes(e.status) || ents.n > 0) {
      throw new AppError('EXAM_STRUCTURE_LOCKED', 'Struktur ujian terkunci karena sudah dipublikasikan atau sudah ada peserta.');
    }
  }

  /** EP-EXM-05 */
  @Get(':id')
  async detail(@Param('id') id: string) {
    const e = await this.load(undefined, id);
    const sections = (await this.db.query('SELECT * FROM exam_sections WHERE exam_id = $1 ORDER BY position', [id])).rows;
    const questions = (await this.db.query(
      `SELECT eq.*, v.version_number, v.stem_plain, v.status AS version_status, v.difficulty, q.status AS question_status,
              s.name AS subject_name, t.name AS topic_name,
              (SELECT max(x.version_number) FROM question_versions x WHERE x.question_id = eq.question_id AND x.status = 'APPROVED') AS latest_approved
         FROM exam_questions eq JOIN question_versions v ON v.id = eq.question_version_id JOIN questions q ON q.id = eq.question_id
         LEFT JOIN subjects s ON s.id = v.subject_id LEFT JOIN topics t ON t.id = v.topic_id
        WHERE eq.exam_id = $1 ORDER BY eq.position`, [id])).rows;
    const ents = await this.db.one('SELECT count(*)::int AS n, (SELECT count(*)::int FROM exam_attempts WHERE exam_id = $1) AS attempts FROM entitlements WHERE exam_id = $1', [id]);
    return {
      exam: {
        id: e.id, slug: e.slug, title: e.title, description: e.description, instructionsHtml: e.instructions_html,
        examType: e.exam_type, deliveryMode: e.delivery_mode, timingMode: e.timing_mode, status: e.status,
        durationMinutes: e.duration_minutes, availableFrom: iso(e.available_from), availableUntil: iso(e.available_until),
        maxAttempts: e.max_attempts, accessDurationDays: e.access_duration_days, publishedAt: iso(e.published_at), seriesId: e.series_id,
        structureLocked: !['DRAFT', 'UNPUBLISHED'].includes(e.status) || ents.n > 0, entitlementCount: ents.n, attemptCount: ents.attempts,
      },
      sections: sections.map((s) => ({
        id: s.id, name: s.name, position: s.position, durationMinutes: s.duration_minutes, instructionsHtml: s.instructions_html,
        questions: questions.filter((q) => q.exam_section_id === s.id).map((q) => ({
          examQuestionId: q.id, questionId: q.question_id, questionVersionId: q.question_version_id, versionNumber: q.version_number,
          position: q.position, weight: Number(q.weight), stemPlain: q.stem_plain, difficulty: q.difficulty,
          subjectName: q.subject_name, topicName: q.topic_name, versionStatus: q.version_status, questionStatus: q.question_status,
          isStale: q.latest_approved !== null && q.latest_approved > q.version_number,
        })),
      })),
    };
  }

  /** EP-EXM-06 */
  @Patch(':id')
  async update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(updateExamSchema, body);
    return this.db.tx(async (c) => {
      const e = await this.load(c, id, true);
      const published = e.status !== 'DRAFT';
      if (published) {
        // FR-EXM-09: setelah terbit hanya metadata, instruksi, dan perpanjangan ketersediaan
        const forbidden = ['durationMinutes', 'maxAttempts', 'availableFrom', 'accessDurationDays'].filter((k) => (input as any)[k] !== undefined);
        if (forbidden.length) throw new AppError('EXAM_STRUCTURE_LOCKED', 'Pengaturan ini tidak dapat diubah setelah ujian dipublikasikan.', forbidden.map((f) => ({ field: f, message: 'Terkunci setelah publikasi.' })));
        if (input.availableUntil !== undefined && input.availableUntil !== null && new Date(input.availableUntil) < new Date(e.available_until)) {
          throw new AppError('VALIDATION_FAILED', 'Data yang dikirim tidak valid.', [{ field: 'availableUntil', issue: 'EARLIER', message: 'Batas ketersediaan hanya dapat diperpanjang (FR-EXM-10).' }]);
        }
      }
      if (input.seriesId !== undefined && input.seriesId !== e.series_id) {
        const attempts = await this.db.one('SELECT count(*)::int AS n FROM exam_attempts WHERE exam_id = $1', [id], c);
        if (attempts.n > 0) throw new AppError('SERIES_LOCKED', 'Seri tidak dapat diubah karena try out ini sudah dikerjakan siswa.');
        if (input.seriesId) await this.assertSeriesType(c, input.seriesId, e.exam_type);
      }
      const set: string[] = [];
      const params: unknown[] = [id];
      const put = (col: string, v: unknown) => { params.push(v); set.push(`${col} = $${params.length}`); };
      if (input.title !== undefined) put('title', input.title);
      if (input.description !== undefined) put('description', input.description);
      if (input.instructionsHtml !== undefined) put('instructions_html', sanitizeRich(input.instructionsHtml));
      if (input.durationMinutes !== undefined) put('duration_minutes', input.durationMinutes);
      if (input.availableFrom !== undefined) put('available_from', input.availableFrom);
      if (input.availableUntil !== undefined) put('available_until', input.availableUntil);
      if (input.maxAttempts !== undefined) put('max_attempts', input.maxAttempts);
      if (input.seriesId !== undefined) put('series_id', input.seriesId);
      if (input.accessDurationDays !== undefined) put('access_duration_days', input.accessDurationDays);
      if (set.length) await c.query(`UPDATE exams SET ${set.join(', ')} WHERE id = $1`, params);
      return { ok: true };
    });
  }

  /** EP-EXM-07 */
  @Put(':id/sections')
  async sections(@Param('id') id: string, @Body() body: unknown) {
    const input = parse(sectionsSchema, body);
    return this.db.tx(async (c) => {
      const e = await this.load(c, id, true);
      await this.assertStructureEditable(c, e);
      const existing = (await this.db.query('SELECT id FROM exam_sections WHERE exam_id = $1', [id], c)).rows.map((r) => r.id);
      const keep = input.sections.filter((s) => s.id && existing.includes(s.id)).map((s) => s.id);
      await c.query('DELETE FROM exam_sections WHERE exam_id = $1 AND NOT (id = ANY($2::uuid[]))', [id, keep]);
      for (const [i, s] of input.sections.entries()) {
        if (s.id && existing.includes(s.id)) {
          await c.query(`UPDATE exam_sections SET name = $2, position = $3, duration_minutes = $4, instructions_html = $5 WHERE id = $1`,
            [s.id, s.name, i + 1, s.durationMinutes ?? null, sanitizeRich(s.instructionsHtml ?? '')]);
        } else {
          await c.query(`INSERT INTO exam_sections (exam_id, name, position, duration_minutes, instructions_html) VALUES ($1,$2,$3,$4,$5)`,
            [id, s.name, i + 1, s.durationMinutes ?? null, sanitizeRich(s.instructionsHtml ?? '')]);
        }
      }
      return { ok: true };
    });
  }

  /** EP-EXM-08 */
  @Put(':id/sections/:sectionId/questions')
  async sectionQuestions(@Param('id') id: string, @Param('sectionId') sectionId: string, @Body() body: unknown) {
    const input = parse(sectionQuestionsSchema, body);
    return this.db.tx(async (c) => {
      const e = await this.load(c, id, true);
      await this.assertStructureEditable(c, e);
      const s = await this.db.one('SELECT id FROM exam_sections WHERE id = $1 AND exam_id = $2', [sectionId, id], c);
      if (!s) throw notFound();
      const versions = input.items.length ? (await this.db.query(
        `SELECT v.id, v.question_id, v.status, q.status AS question_status FROM question_versions v JOIN questions q ON q.id = v.question_id
          WHERE v.id = ANY($1::uuid[])`, [input.items.map((i) => i.questionVersionId)], c)).rows : [];
      const issues: ErrorDetail[] = [];
      const seen = new Set<string>();
      for (const [i, it] of input.items.entries()) {
        const v = versions.find((x) => x.id === it.questionVersionId);
        if (!v) { issues.push({ field: `items[${i}]`, issue: 'NOT_FOUND', message: `Soal ke-${i + 1} tidak ditemukan.` }); continue; }
        if (v.status !== 'APPROVED') issues.push({ field: `items[${i}]`, issue: 'NOT_APPROVED', message: `Soal ke-${i + 1} belum disetujui.` });
        if (v.question_status !== 'ACTIVE') issues.push({ field: `items[${i}]`, issue: 'QUESTION_RETIRED', message: `Soal ke-${i + 1} sudah di-retire.` });
        if (seen.has(v.question_id)) issues.push({ field: `items[${i}]`, issue: 'DUPLICATE', message: `Soal ke-${i + 1} ganda.` });
        seen.add(v.question_id);
      }
      const other = (await this.db.query('SELECT question_id FROM exam_questions WHERE exam_id = $1 AND exam_section_id <> $2', [id, sectionId], c)).rows;
      for (const o of other) if (seen.has(o.question_id)) issues.push({ field: 'items', issue: 'DUPLICATE_IN_EXAM', message: 'Ada soal yang sudah dipakai di subtes lain pada ujian ini (FR-EXM-03).' });
      if (issues.length) throw new AppError('VALIDATION_FAILED', 'Daftar soal tidak valid.', issues);
      await c.query('DELETE FROM exam_questions WHERE exam_section_id = $1', [sectionId]);
      for (const [i, it] of input.items.entries()) {
        const v = versions.find((x) => x.id === it.questionVersionId)!;
        await c.query(
          `INSERT INTO exam_questions (exam_id, exam_section_id, question_id, question_version_id, position, weight) VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, sectionId, v.question_id, v.id, i + 1, it.weight ?? 1]);
      }
      return { ok: true, count: input.items.length };
    });
  }

  /** FR-EXM-06: seluruh pemeriksaan publikasi. */
  private async publishIssues(c: Tx, e: any) {
    const issues: ErrorDetail[] = [];
    const sections = (await this.db.query(
      `SELECT s.*, (SELECT count(*) FROM exam_questions q WHERE q.exam_section_id = s.id)::int AS n FROM exam_sections s WHERE s.exam_id = $1 ORDER BY position`, [e.id], c)).rows;
    if (sections.length === 0) issues.push({ field: 'sections', issue: 'NO_SECTION', message: 'Ujian belum memiliki subtes.' });
    sections.forEach((s, i) => {
      if (s.n === 0) issues.push({ field: `sections[${i}]`, issue: 'SECTION_EMPTY', message: `Subtes "${s.name}" belum memiliki soal.` });
      if (e.timing_mode === 'PER_SECTION' && !s.duration_minutes) issues.push({ field: `sections[${i}]`, issue: 'DURATION_MISSING', message: `Durasi subtes "${s.name}" belum diisi.` });
    });
    if (e.timing_mode === 'TOTAL' && !e.duration_minutes) issues.push({ field: 'durationMinutes', issue: 'DURATION_MISSING', message: 'Durasi total ujian belum diisi.' });
    const bad = (await this.db.query(
      `SELECT eq.position, s.name, v.status, q.status AS qstatus FROM exam_questions eq
         JOIN exam_sections s ON s.id = eq.exam_section_id JOIN question_versions v ON v.id = eq.question_version_id JOIN questions q ON q.id = eq.question_id
        WHERE eq.exam_id = $1 AND (v.status <> 'APPROVED' OR q.status <> 'ACTIVE')`, [e.id], c)).rows;
    for (const b of bad) issues.push({ field: 'questions', issue: b.qstatus !== 'ACTIVE' ? 'QUESTION_RETIRED' : 'NOT_APPROVED',
      message: `Soal nomor ${b.position} pada subtes "${b.name}" ${b.qstatus !== 'ACTIVE' ? 'sudah di-retire' : 'belum disetujui'}.` });
    if (!e.available_from || !e.available_until) issues.push({ field: 'availability', issue: 'MISSING', message: 'Periode ketersediaan belum diisi.' });
    else if (new Date(e.available_from) >= new Date(e.available_until)) issues.push({ field: 'availability', issue: 'ORDER', message: 'Tanggal mulai harus sebelum tanggal berakhir.' });
    else if (new Date(e.available_until) <= new Date()) issues.push({ field: 'availability', issue: 'PAST', message: 'Periode ketersediaan sudah lewat.' });
    // FR-EXM-06 (6) v3.0: setiap periode harus masuk musim agar dapat diakses lewat paket
    if (!e.series_id) issues.push({ field: 'seriesId', issue: 'SEASON_MISSING', message: 'Pilih musim try out untuk ujian ini.' });
    return issues;
  }

  /** FR-EXM-13: peringatan parameter Full Try Out (bukan penolakan). */
  private async publishWarnings(c: Tx, e: any) {
    const warnings: ErrorDetail[] = [];
    const n = (await this.db.one('SELECT count(*)::int AS n FROM exam_questions WHERE exam_id = $1', [e.id], c)).n;
    const mins = e.timing_mode === 'TOTAL' ? (e.duration_minutes ?? 0)
      : Number((await this.db.one('SELECT COALESCE(sum(duration_minutes), 0)::int AS m FROM exam_sections WHERE exam_id = $1', [e.id], c)).m);
    const range = (key: string) => this.settings.get<{ min: number; max: number } | null>(key, null, c);
    const q = await range('tryout.full.question_count_range');
    const d = await range('tryout.full.duration_minutes_range');
    if (q && (n < q.min || n > q.max)) warnings.push({ field: 'questions', issue: 'FULL_QUESTION_COUNT', message: `Full Try Out berisi ${n} soal; disarankan ${q.min}–${q.max}.` });
    if (d && mins && (mins < d.min || mins > d.max)) warnings.push({ field: 'duration', issue: 'FULL_DURATION', message: `Durasi ${mins} menit; disarankan ${d.min}–${d.max} menit.` });
    return warnings;
  }

  /** EP-EXM-09 */
  @Post(':id/publish') @HttpCode(200)
  async publish(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.db.tx(async (c) => {
      const e = await this.load(c, id, true);
      if (e.status === 'PUBLISHED') return { exam: { id, status: 'PUBLISHED' }, issues: [], warnings: [] };
      if (e.status === 'ARCHIVED') throw new AppError('EXAM_STRUCTURE_LOCKED', 'Ujian yang diarsipkan tidak dapat dipublikasikan.');
      const input = parse(publishSchema, body);
      const issues = await this.publishIssues(c, e);
      const warnings = await this.publishWarnings(c, e);
      if (input.dryRun) return { exam: { id, status: e.status }, issues, warnings };
      if (issues.length) throw new AppError('PUBLISH_VALIDATION_FAILED', 'Exam belum dapat dipublikasikan.', issues);
      if (warnings.length && !input.confirmWarnings) {
        throw new AppError('PUBLISH_WARNINGS_UNCONFIRMED', 'Ada peringatan yang perlu Anda konfirmasi sebelum menerbitkan.', warnings);
      }
      await c.query(`UPDATE exams SET status = 'PUBLISHED', published_at = COALESCE(published_at, now()), published_by = $2 WHERE id = $1`, [id, me.id]);
      await audit(c, me, 'EXAM_PUBLISHED', 'exam', id, { status: e.status }, { status: 'PUBLISHED', warnings: warnings.map((w) => w.issue) },
        warnings.length ? 'Diterbitkan dengan peringatan parameter produk' : null);
      return { exam: { id, status: 'PUBLISHED' }, issues: [], warnings };
    });
  }

  /** EP-EXM-10 (BR-AVL-04): entitlement yang ada tetap dapat dipakai. */
  @Post(':id/unpublish') @HttpCode(200)
  async unpublish(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() body: any) {
    const reason = String(body?.reason ?? '').trim();
    if (reason.length < 10) throw new AppError('VALIDATION_FAILED', 'Data yang dikirim tidak valid.', [{ field: 'reason', issue: 'TOO_SHORT', message: 'Alasan minimal 10 karakter.' }]);
    return this.db.tx(async (c) => {
      const e = await this.load(c, id, true);
      if (e.status !== 'PUBLISHED') throw new AppError('EXAM_STRUCTURE_LOCKED', 'Hanya ujian yang sedang terbit yang dapat ditarik.');
      await c.query(`UPDATE exams SET status = 'UNPUBLISHED' WHERE id = $1`, [id]);
      await audit(c, me, 'EXAM_UNPUBLISHED', 'exam', id, { status: 'PUBLISHED' }, { status: 'UNPUBLISHED' }, reason);
      return { exam: { id, status: 'UNPUBLISHED' } };
    });
  }
}

/** EP-SER-01..03 */
@Controller('admin/series') @Roles('EXAM_ADMIN')
export class SeriesAdminController {
  constructor(private db: Db) {}

  @Get()
  async list() {
    const r = await this.db.query(
      `SELECT s.*, (SELECT count(*) FROM exams e WHERE e.series_id = s.id)::int AS exam_count FROM exam_series s ORDER BY s.created_at DESC`);
    return { data: r.rows.map((x) => ({ id: x.id, code: x.code, name: x.name, description: x.description, examType: x.exam_type,
      examDate: x.exam_date ? toDate(x.exam_date) : null,
      scoringScheme: x.scoring_scheme, status: x.status, examCount: x.exam_count })) };
  }

  @Post()
  async create(@CurrentUser() me: AuthUser, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = parse(createSeriesSchema, body);
    try {
      const r = await this.db.one(
        `INSERT INTO exam_series (code, name, description, exam_type, exam_date, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [input.code, input.name, input.description, input.examType, input.examDate ?? null, me.id]);
      res.status(201);
      return { series: { id: r!.id } };
    } catch (e: any) {
      if (e?.code === '23505') throw new AppError('VALIDATION_FAILED', 'Kode seri sudah dipakai.', [{ field: 'code', issue: 'DUPLICATE', message: 'Kode seri sudah dipakai.' }], 409);
      throw e;
    }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const name = body?.name === undefined ? null : String(body.name).trim();
    const status = body?.status === undefined ? null : String(body.status);
    if (status && !['ACTIVE', 'ARCHIVED'].includes(status)) throw new AppError('VALIDATION_FAILED', 'Status tidak valid.');
    const r = await this.db.one(
      `UPDATE exam_series SET name = COALESCE($2, name), description = COALESCE($3, description), status = COALESCE($4, status),
              exam_date = CASE WHEN $5::boolean THEN $6::date ELSE exam_date END
        WHERE id = $1 RETURNING id`, [id, name, body?.description ?? null, status, body?.examDate !== undefined,
        body?.examDate && /^\d{4}-\d{2}-\d{2}$/.test(String(body.examDate)) ? String(body.examDate) : null]);
    if (!r) throw notFound();
    return { series: { id } };
  }
}

/** DATE PostgreSQL -> 'YYYY-MM-DD' tanpa pergeseran zona waktu. */
export function toDate(d: Date | string) {
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
