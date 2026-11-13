import { Body, Controller, Get, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { studyProgramPatchSchema, studyProgramSchema, targetsSchema, universitySchema } from '@cogniverse/contracts';
import { AppError, Db, notFound, parse } from '../common/infra';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { audit } from '../common/audit';
import { StudyPlanner } from './planner';

/** Skor acuan hanya dikirim bila bersumber (BR-TGT-02); skala sumber ≠ skala Cogniverse (BR-TGT-03). */
/** EP-TGT-05/06: skor tanpa sumber/tahun ditolak dengan kode khusus (BR-TGT-02, TC-TGT-01). */
function assertRefSource(body: any) {
  const r = body?.reference;
  if (r && r.score != null && (!String(r.source ?? '').trim() || !r.year)) {
    throw new AppError('REFERENCE_SOURCE_REQUIRED', 'Isi sumber dan tahun data sebelum menyimpan skor acuan.',
      [{ field: 'reference', message: 'Sumber dan tahun wajib diisi.' }]);
  }
}

const refDto = (p: any) => (p.reference_score === null || p.reference_score === undefined ? null
  : { score: Number(p.reference_score), source: p.reference_source, year: p.reference_year });

@Controller()
export class TargetsController {
  constructor(private db: Db, private planner: StudyPlanner) {}

  /** EP-TGT-01 */
  @Get('universities')
  async universities(@Query('q') q = '', @Query('limit') limit = '20') {
    const r = await this.db.query(
      `SELECT u.*, (SELECT count(*) FROM study_programs p WHERE p.university_id = u.id AND p.is_active)::int AS program_count
         FROM universities u WHERE u.is_active AND ($1 = '' OR u.name ILIKE '%' || $1 || '%' OR u.short_name ILIKE $1 || '%')
        ORDER BY u.name LIMIT $2`, [String(q).trim(), Math.min(50, Math.max(1, Number(limit) || 20))]);
    return { data: r.rows.map((u) => ({ id: u.id, name: u.name, shortName: u.short_name, province: u.province, programCount: u.program_count })) };
  }

  /** EP-TGT-02 */
  @Get('universities/:id/programs')
  async programs(@Param('id') id: string, @Query('q') q = '') {
    const r = await this.db.query(
      `SELECT * FROM study_programs WHERE university_id = $1 AND is_active AND ($2 = '' OR name ILIKE '%' || $2 || '%') ORDER BY name`,
      [id, String(q).trim()]);
    return { data: r.rows.map((p) => ({ id: p.id, name: p.name, reference: refDto(p) })) };
  }

  /** EP-TGT-03 — target + skor terbaru + selisih ke target pribadi (FR-TGT-04). */
  @Roles('STUDENT') @Get('users/me/targets')
  async mine(@CurrentUser() me: AuthUser) {
    const t = (await this.db.query(
      `SELECT t.*, p.name AS program_name, p.reference_score, p.reference_source, p.reference_year, u.name AS university_name, u.short_name
         FROM student_targets t LEFT JOIN study_programs p ON p.id = t.study_program_id LEFT JOIN universities u ON u.id = p.university_id
        WHERE t.user_id = $1 ORDER BY t.priority`, [me.id])).rows;
    const latest = await this.db.one(
      `SELECT r.total_score, r.attempt_id, a.submitted_at, e.title FROM exam_results r JOIN exam_attempts a ON a.id = r.attempt_id
         JOIN exams e ON e.id = r.exam_id
        WHERE r.user_id = $1 AND r.is_current AND r.publication_status = 'PUBLISHED' ORDER BY a.submitted_at DESC LIMIT 1`, [me.id]);
    const primary = t.find((x) => x.priority === 1);
    const latestScore = latest ? Math.round(Number(latest.total_score)) : null;
    return {
      targets: t.map((x) => ({
        priority: x.priority, studyProgramId: x.study_program_id,
        university: x.university_name ?? x.custom_university, universityShort: x.short_name ?? null,
        program: x.program_name ?? x.custom_program, isCustom: !x.study_program_id,
        personalTargetScore: x.personal_target_score, reference: x.study_program_id ? refDto(x) : null,
      })),
      latest: latest ? { score: latestScore, attemptId: latest.attempt_id, examTitle: latest.title, submittedAt: latest.submitted_at } : null,
      gap: primary?.personal_target_score != null && latestScore != null ? primary.personal_target_score - latestScore : null,
    };
  }

  /** EP-TGT-04 */
  @Roles('STUDENT') @Put('users/me/targets')
  async save(@CurrentUser() me: AuthUser, @Body() body: unknown) {
    const input = parse(targetsSchema, body);
    await this.db.tx(async (c) => {
      for (const t of input.targets) {
        if (t.studyProgramId) {
          const ok = await this.db.one('SELECT 1 FROM study_programs WHERE id = $1 AND is_active', [t.studyProgramId], c);
          if (!ok) throw new AppError('VALIDATION_FAILED', 'Program studi tidak ditemukan.', [{ field: 'studyProgramId', message: 'Program studi tidak ditemukan.' }]);
        }
      }
      const before = (await c.query('SELECT priority, study_program_id, custom_university, custom_program, personal_target_score FROM student_targets WHERE user_id = $1', [me.id])).rows;
      await c.query('DELETE FROM student_targets WHERE user_id = $1', [me.id]);
      for (const t of input.targets) {
        await c.query(
          `INSERT INTO student_targets (user_id, priority, study_program_id, custom_university, custom_program, personal_target_score)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [me.id, t.priority, t.studyProgramId ?? null, t.studyProgramId ? null : t.customUniversity, t.studyProgramId ? null : t.customProgram,
           t.personalTargetScore ?? null]);
      }
      await audit(c, me, 'TARGET_CHANGED', 'user', me.id, { targets: before }, { targets: input.targets }, null);
    });
    // Target memengaruhi intensitas roadmap (FR-TGT-06)
    await this.planner.buildSafely(me.id);
    return this.mine(me);
  }
}

/** EP-TGT-05..07 + daftar untuk ADM-16 */
@Controller('admin') @Roles('EXAM_ADMIN')
export class TargetsAdminController {
  constructor(private db: Db) {}

  @Get('universities')
  async list() {
    const u = (await this.db.query('SELECT * FROM universities ORDER BY name')).rows;
    const p = (await this.db.query(
      `SELECT p.*, (SELECT count(*) FROM student_targets t WHERE t.study_program_id = p.id)::int AS target_count FROM study_programs p ORDER BY p.name`)).rows;
    return { data: u.map((x) => ({ id: x.id, name: x.name, shortName: x.short_name, province: x.province,
      programs: p.filter((y) => y.university_id === x.id).map((y) => ({ id: y.id, name: y.name, reference: refDto(y), targetCount: y.target_count })) })) };
  }

  @Post('universities')
  async createUniversity(@CurrentUser() me: AuthUser, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = parse(universitySchema, body);
    try {
      const r = await this.db.one('INSERT INTO universities (name, short_name, province) VALUES ($1,$2,$3) RETURNING id',
        [input.name, input.shortName ?? null, input.province ?? null]);
      res.status(201);
      return { university: { id: r!.id } };
    } catch (e: any) {
      if (e?.code === '23505') throw new AppError('VALIDATION_FAILED', 'Nama kampus sudah ada.', [], 409);
      throw e;
    }
  }

  @Post('study-programs')
  async createProgram(@CurrentUser() me: AuthUser, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    assertRefSource(body);
    const input = parse(studyProgramSchema, body);
    const ref = input.reference ?? null;
    const r = await this.db.tx(async (c) => {
      const row = await this.db.one(
        `INSERT INTO study_programs (university_id, name, reference_score, reference_source, reference_year) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [input.universityId, input.name, ref?.score ?? null, ref?.source ?? null, ref?.year ?? null], c);
      await audit(c, me, 'STUDY_PROGRAM_CREATED', 'study_program', row!.id, null, input, null);
      return row;
    });
    res.status(201);
    return { program: { id: r!.id } };
  }

  @Patch('study-programs/:id')
  async updateProgram(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    assertRefSource(body);
    const input = parse(studyProgramPatchSchema, body);
    return this.db.tx(async (c) => {
      const before = await this.db.one('SELECT * FROM study_programs WHERE id = $1 FOR UPDATE', [id], c);
      if (!before) throw notFound();
      const ref = input.reference === undefined ? undefined : input.reference;
      await c.query(
        `UPDATE study_programs SET name = COALESCE($2, name),
           reference_score = CASE WHEN $3::boolean THEN $4 ELSE reference_score END,
           reference_source = CASE WHEN $3::boolean THEN $5 ELSE reference_source END,
           reference_year = CASE WHEN $3::boolean THEN $6::smallint ELSE reference_year END WHERE id = $1`,
        [id, input.name ?? null, ref !== undefined, ref?.score ?? null, ref?.source ?? null, ref?.year ?? null]);
      await audit(c, me, 'STUDY_PROGRAM_UPDATED', 'study_program', id, refDto(before), input, null);
      return { program: { id } };
    });
  }
}
