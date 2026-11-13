import { Injectable, OnModuleDestroy, HttpException, ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { ZodTypeAny, ZodError, z } from 'zod';
import type { ErrorCode } from '@cogniverse/contracts';

// ---------------------------------------------------------------- config
export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/cogniverse',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  isProd: process.env.NODE_ENV === 'production',
  graceSeconds: Number(process.env.ATTEMPT_GRACE_SECONDS ?? 5), // BR-TMO-03
  sweepIntervalMs: Number(process.env.SWEEP_INTERVAL_MS ?? 15000), // TDD 6.3.4
};

// ---------------------------------------------------------------- errors
const STATUS: Partial<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400, MALFORMED_REQUEST: 400,
  UNAUTHENTICATED: 401, SESSION_EXPIRED: 401, INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403, EMAIL_NOT_VERIFIED: 403, PROFILE_INCOMPLETE: 403, CONSENT_REQUIRED: 403,
  ACCOUNT_SUSPENDED: 403, SELF_REVIEW_FORBIDDEN: 403,
  NOT_FOUND: 404, TOKEN_EXPIRED_OR_USED: 410,
  PUBLISH_VALIDATION_FAILED: 422, SUBMISSION_INCOMPLETE: 422, PUBLISH_WARNINGS_UNCONFIRMED: 422, SERIES_TYPE_MISMATCH: 400,
  ATTEMPT_SESSION_TAKEN_OVER: 423, RATE_LIMITED: 429, INTERNAL_ERROR: 500,
  NO_ACCESS: 402, REFERENCE_SOURCE_REQUIRED: 400, TARGET_REQUIRED: 403,
};

export type ErrorDetail = { field?: string; issue?: string; message: string };
export class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: ErrorDetail[], public status = STATUS[code] ?? 409) {
    super(message);
  }
}
export const notFound = () => new AppError('NOT_FOUND', 'Data tidak ditemukan.');

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private log = new Logger('Error');
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const requestId = (req as any).requestId;
    let status = 500;
    let body: any;
    if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message, details: err.details };
    } else if ((err as any)?.code === '22P02') {
      // UUID tidak valid pada path → diperlakukan sebagai tidak ditemukan
      status = 404;
      body = { code: 'NOT_FOUND', message: 'Data tidak ditemukan.' };
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      body = status === 404
        ? { code: 'NOT_FOUND', message: 'Data tidak ditemukan.' }
        : { code: 'MALFORMED_REQUEST', message: 'Permintaan tidak dapat diproses.' };
    } else {
      this.log.error((err as Error)?.stack ?? String(err), requestId);
      body = { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan di server. Coba lagi beberapa saat lagi.' };
    }
    res.status(status).json({ error: { ...body, requestId } });
  }
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  try {
    return schema.parse(data ?? {});
  } catch (e) {
    if (e instanceof ZodError) {
      throw new AppError('VALIDATION_FAILED', 'Data yang dikirim tidak valid.',
        e.issues.map((i) => ({ field: i.path.join('.'), issue: i.code.toUpperCase(), message: i.message })));
    }
    throw e;
  }
}

// ---------------------------------------------------------------- database
export type Tx = PoolClient;

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
  constructor() {
    // Koneksi idle yang diputus server tidak boleh menjatuhkan proses
    this.pool.on('error', (e) => new Logger('Db').warn(`Koneksi database terputus: ${e.message}`));
  }

  async query<R extends QueryResultRow = any>(sql: string, params: unknown[] = [], client?: Tx) {
    return (client ?? this.pool).query<R>(sql, params);
  }
  async one<R extends QueryResultRow = any>(sql: string, params: unknown[] = [], client?: Tx): Promise<R | null> {
    return (await this.query<R>(sql, params, client)).rows[0] ?? null;
  }
  async tx<T>(fn: (c: Tx) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}

// ---------------------------------------------------------------- middleware
/** X-Request-Id, Cache-Control, dan perlindungan CSRF (TDD 4.1, 5.13). */
export function httpMiddleware(req: Request, res: Response, next: NextFunction) {
  const id = crypto.randomUUID();
  (req as any).requestId = id;
  res.setHeader('X-Request-Id', id);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!req.path.startsWith('/api/v1/catalog')) res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    const allowed = origin === undefined || origin === config.webOrigin;
    if (req.headers['x-cv-client'] !== 'web' || !allowed) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Permintaan ditolak.', requestId: id } });
      return;
    }
  }
  next();
}

// ---------------------------------------------------------------- rate limit
// Jendela geser di memori proses. TDD 5.10 memakai Redis; cukup untuk satu instance pengembangan.
const buckets = new Map<string, number[]>();
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    const retry = Math.ceil((windowMs - (now - arr[0])) / 1000);
    throw new AppError('RATE_LIMITED', `Terlalu banyak percobaan. Coba lagi dalam ${retry} detik.`);
  }
  arr.push(now);
  buckets.set(key, arr);
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
