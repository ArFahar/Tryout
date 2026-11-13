import { Controller, Get, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Db, Tx, config, notFound } from '../common/infra';
import { Public } from '../common/auth';

/**
 * AD-08: tabel notifications sekaligus outbox email.
 * Penyedia email belum dipilih (OQ-T3), sehingga MailerPort di sini adalah DevMailer:
 * email ditandai terkirim dan isinya dapat dilihat lewat GET /api/v1/dev/outbox (hanya non-produksi).
 */
export interface MailerPort { send(to: string, template: string, payload: Record<string, unknown>): Promise<void> }

class DevMailer implements MailerPort {
  private log = new Logger('DevMailer');
  async send(to: string, template: string, payload: Record<string, unknown>) {
    this.log.log(`${template} -> ${to} ${payload.link ?? ''}`);
  }
}

@Injectable()
export class Notifications implements OnModuleInit, OnModuleDestroy {
  private mailer: MailerPort = new DevMailer();
  private timer?: NodeJS.Timeout;
  constructor(private db: Db) {}

  async enqueue(c: Tx, n: { userId?: string; recipient: string; template: string; dedupeKey: string; payload: Record<string, unknown> }) {
    await c.query(
      `INSERT INTO notifications (user_id, template, recipient, dedupe_key, payload) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [n.userId ?? null, n.template, n.recipient, n.dedupeKey, n.payload]);
  }

  onModuleInit() {
    this.timer = setInterval(() => this.dispatch().catch(() => {}), 3000);
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async dispatch() {
    const rows = await this.db.query(
      `UPDATE notifications SET status = 'SENDING', attempt_count = attempt_count + 1
        WHERE id IN (SELECT id FROM notifications WHERE status = 'PENDING' AND next_attempt_at <= now()
                     ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED)
        RETURNING id, recipient, template, payload, attempt_count`);
    for (const n of rows.rows) {
      try {
        await this.mailer.send(n.recipient, n.template, n.payload);
        await this.db.query(`UPDATE notifications SET status = 'SENT', sent_at = now() WHERE id = $1`, [n.id]);
      } catch (e: any) {
        const failed = n.attempt_count >= 5;
        await this.db.query(
          `UPDATE notifications SET status = $2, last_error = $3,
             next_attempt_at = now() + make_interval(secs => power(2, attempt_count)::int * 30) WHERE id = $1`,
          [n.id, failed ? 'FAILED' : 'PENDING', String(e?.message ?? e)]);
      }
    }
  }
}

@Controller('dev')
export class DevOutboxController {
  constructor(private db: Db) {}
  /** Hanya untuk pengembangan lokal: menampilkan email yang "terkirim". */
  @Public() @Get('outbox')
  async outbox() {
    if (config.isProd) throw notFound();
    const r = await this.db.query(
      `SELECT id, recipient, template, payload, status, created_at FROM notifications ORDER BY created_at DESC LIMIT 30`);
    return { data: r.rows.map((n) => ({ id: n.id, recipient: n.recipient, template: n.template, payload: n.payload, status: n.status, createdAt: n.created_at })) };
  }
}
