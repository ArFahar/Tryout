import { Body, Controller, Get, Headers, HttpCode, Injectable, OnModuleDestroy, OnModuleInit, Param, Post, Put, Query, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { startAttemptSchema, saveAnswerSchema, batchAnswerSchema, ATTEMPT_SESSION_HEADER } from '@cogniverse/contracts';
import { AppError, config, parse, rateLimit } from '../common/infra';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { EngineService } from './engine.service';
import { ScoringService } from '../scoring/scoring.service';

@Controller() @Roles('STUDENT')
export class EngineController {
  constructor(private engine: EngineService, private scoring: ScoringService) {}

  /** EP-ATT-01 */
  @Get('exams/:examId/start-eligibility')
  eligibility(@CurrentUser() me: AuthUser, @Param('examId') examId: string) {
    return this.engine.eligibility(me.id, examId);
  }

  /** EP-ATT-02 */
  @Post('attempts')
  async start(@CurrentUser() me: AuthUser, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    rateLimit(`start:${me.id}`, 10, 60e3);
    const { examId } = parse(startAttemptSchema, body);
    const r = await this.engine.startOrResume(me.id, examId);
    res.status(r.created ? 201 : 200);
    return r.body;
  }

  /** EP-ATT-03 */
  @Get('attempts/:id')
  state(@CurrentUser() me: AuthUser, @Param('id') id: string, @Headers(ATTEMPT_SESSION_HEADER) token: string) {
    return this.engine.state(me.id, id, token ?? '');
  }

  /** EP-ATT-04 */
  @Get('attempts/:id/status')
  status(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.engine.status(me.id, id);
  }

  /** EP-ATT-05 */
  @Post('attempts/:id/sections/:sectionId/end') @HttpCode(200)
  endSection(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('sectionId') sid: string,
    @Headers(ATTEMPT_SESSION_HEADER) token: string) {
    return this.engine.endSection(me.id, id, sid, token ?? '');
  }

  /** EP-ATT-06 */
  @Post('attempts/:id/submit') @HttpCode(200)
  submit(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.engine.submit(me.id, id);
  }

  /** EP-ANS-01 */
  @Put('attempts/:id/answers/:questionId')
  save(@CurrentUser() me: AuthUser, @Param('id') id: string, @Param('questionId') qid: string,
    @Headers(ATTEMPT_SESSION_HEADER) token: string, @Body() body: unknown) {
    rateLimit(`answers:${id}`, 120, 60e3);
    return this.engine.saveAnswer(me.id, id, qid, token ?? '', parse(saveAnswerSchema, body));
  }

  /** EP-ANS-02: kegagalan satu item tidak menggagalkan lainnya. */
  @Post('attempts/:id/answers/batch') @HttpCode(200)
  async batch(@CurrentUser() me: AuthUser, @Param('id') id: string, @Headers(ATTEMPT_SESSION_HEADER) token: string, @Body() body: unknown) {
    rateLimit(`answers:${id}`, 120, 60e3);
    const { items } = parse(batchAnswerSchema, body);
    const results = [];
    let serverTime: string | null = null;
    for (const item of items) {
      try {
        const r = await this.engine.saveAnswer(me.id, id, item.questionId, token ?? '', item);
        serverTime = r.serverTime;
        results.push({ questionId: item.questionId, saved: r.saved, clientSeq: r.clientSeq });
      } catch (e) {
        if (e instanceof AppError && e.code === 'ATTEMPT_SESSION_TAKEN_OVER') throw e;
        results.push({ questionId: item.questionId, saved: false, code: e instanceof AppError ? e.code : 'INTERNAL_ERROR' });
      }
    }
    return { results, serverTime: serverTime ?? new Date().toISOString() };
  }

  /** EP-ATT-07 */
  @Get('users/me/attempts')
  async history(@CurrentUser() me: AuthUser) {
    return { data: await this.engine.history(me.id) };
  }

  /** EP-RES-01 */
  @Get('attempts/:id/result')
  result(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.scoring.result(me.id, id);
  }

  /** EP-RES-02 */
  @Get('attempts/:id/review')
  review(@CurrentUser() me: AuthUser, @Param('id') id: string, @Query('filter') filter = 'all', @Query('topicId') topicId?: string) {
    return this.scoring.review(me.id, id, filter, topicId);
  }
}

/** Sweeper auto-submit dan scoring (TDD 6.3.4). Pekerjaan tertunda BullMQ belum dipakai; sweeper menjadi jalur utama. */
@Injectable()
export class EngineSweeper implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private log = new Logger('Sweeper');
  constructor(private engine: EngineService) {}
  onModuleInit() {
    this.timer = setInterval(async () => {
      if (this.running) return;
      this.running = true;
      try { await this.engine.sweep(); } catch (e) { this.log.error(e); } finally { this.running = false; }
    }, config.sweepIntervalMs);
  }
  onModuleDestroy() { clearInterval(this.timer); }
}
