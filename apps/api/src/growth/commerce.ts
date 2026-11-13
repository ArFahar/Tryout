import { Body, Controller, Get, HttpCode, Injectable, Logger, OnModuleDestroy, OnModuleInit, Param, Patch, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import crypto from 'node:crypto';
import { createOrderSchema, devPaySchema, packagePatchSchema, packageSchema, redeemSchema } from '@cogniverse/contracts';
import { AppError, Db, Tx, config, iso, notFound, parse, rateLimit } from '../common/infra';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth';
import { audit } from '../common/audit';
import { Settings } from '../common/settings';
import { ReferralService } from './referral';

/** Akhir hari (23.59.59 WIB) dari ekspresi DATE SQL — OQ-T12. */
const endOfDayWib = (dateExpr: string) => `((${dateExpr})::timestamp + time '23:59:59') AT TIME ZONE 'Asia/Jakarta'`;

const pkgDto = (p: any) => ({
  id: p.id, slug: p.slug, type: p.product_type, name: p.name, description: p.description, status: p.status,
  priceAmount: Number(p.price_amount), tryoutCredits: p.tryout_credits,
  pricePerPeriod: p.tryout_credits ? Math.round(Number(p.price_amount) / p.tryout_credits) : null,
  validUntil: iso(p.valid_until), seriesId: p.series_id,
});

@Injectable()
export class Commerce implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Commerce');
  private timer?: NodeJS.Timeout;
  constructor(private db: Db, private settings: Settings, private refs: ReferralService) {}

  onModuleInit() { this.timer = setInterval(() => this.expireOrders().catch((e) => this.log.error(e)), 60_000); }
  onModuleDestroy() { clearInterval(this.timer); }

  /** Musim aktif: ACTIVE, tanggal SNBT belum lewat (atau belum ditetapkan), terdekat lebih dulu. */
  async activeSeason(c?: Tx) {
    const days = Number(await this.settings.get('lifetime.days_before_exam', 7, c));
    return this.db.one(
      `SELECT s.*, ${endOfDayWib('s.exam_date - $1::int')} AS lifetime_ends_at, ${endOfDayWib('s.exam_date')} AS credits_end_at
         FROM exam_series s WHERE s.status = 'ACTIVE' AND (s.exam_date IS NULL OR s.exam_date >= (now() AT TIME ZONE 'Asia/Jakarta')::date)
        ORDER BY s.exam_date NULLS LAST, s.created_at LIMIT 1`, [days], c);
  }

  /** EP-PKG-01 */
  async packages() {
    const season = await this.activeSeason();
    if (!season) return { season: null, data: [] };
    const r = await this.db.query(
      `SELECT p.*, CASE WHEN p.product_type = 'LIFETIME' THEN $2::timestamptz ELSE $3::timestamptz END AS valid_until
         FROM products p WHERE p.is_package AND p.status = 'ACTIVE' AND p.series_id = $1 ORDER BY p.display_order, p.price_amount`,
      [season.id, season.lifetime_ends_at, season.credits_end_at]);
    return {
      season: { id: season.id, name: season.name, examDate: season.exam_date ? dateOnly(season.exam_date) : null,
        lifetimeEndsAt: iso(season.lifetime_ends_at), creditsEndAt: iso(season.credits_end_at) },
      data: r.rows.map(pkgDto),
    };
  }

  /** EP-PKG-02 / FR-PKG-05 */
  async access(userId: string, c?: Tx) {
    const grants = (await this.db.query(
      `SELECT g.*, s.name AS series_name FROM package_grants g JOIN exam_series s ON s.id = g.series_id
        WHERE g.user_id = $1 AND g.status = 'ACTIVE' AND g.valid_until >= now() ORDER BY g.valid_until`, [userId], c)).rows;
    const pass = grants.find((g) => g.kind === 'SEASON_PASS');
    const credits = grants.filter((g) => g.kind === 'CREDITS');
    return {
      credits: {
        available: credits.reduce((n, g) => n + g.credits_total - g.credits_used, 0),
        grants: credits.map((g) => ({ id: g.id, seriesName: g.series_name, total: g.credits_total, used: g.credits_used, validUntil: iso(g.valid_until) })),
      },
      seasonPass: pass ? { id: pass.id, seriesId: pass.series_id, seriesName: pass.series_name, validUntil: iso(pass.valid_until) } : null,
    };
  }

  /** Prasyarat akun untuk order dan penukaran (FR-PAY-01 (4), FR-AUTH-02, TC-TGT-03). */
  private async assertReady(c: Tx, userId: string) {
    const u = await this.db.one(
      `SELECT u.email_verified_at, p.onboarding_completed_at,
              EXISTS (SELECT 1 FROM student_targets t WHERE t.user_id = u.id AND t.priority = 1) AS has_target
         FROM users u LEFT JOIN student_profiles p ON p.user_id = u.id WHERE u.id = $1`, [userId], c);
    if (!u?.email_verified_at) throw new AppError('EMAIL_NOT_VERIFIED', 'Verifikasi email kamu terlebih dahulu.');
    if (!u.onboarding_completed_at) throw new AppError('PROFILE_INCOMPLETE', 'Lengkapi profil kamu terlebih dahulu.');
    if (!u.has_target) throw new AppError('TARGET_REQUIRED', 'Pilih kampus dan jurusan tujuan terlebih dahulu.');
  }

  /** EP-PKG-03 — TDD 6.7.2 */
  async redeem(userId: string, examId: string, useCredit: boolean) {
    try {
      return await this.db.tx(async (c) => {
        await this.assertReady(c, userId);
        const exam = await this.db.one(
          `SELECT e.* FROM exams e JOIN exam_series s ON s.id = e.series_id
            WHERE e.id = $1 AND e.status = 'PUBLISHED' AND now() BETWEEN e.available_from AND e.available_until`, [examId], c);
        if (!exam) throw new AppError('EXAM_NOT_AVAILABLE', 'Periode ini sedang tidak dibuka.');
        const existing = await this.db.one(`SELECT * FROM entitlements WHERE user_id = $1 AND exam_id = $2 AND source = 'PACKAGE'`, [userId, examId], c);
        if (existing) return { entitlement: entDto(existing), created: false, creditsRemaining: (await this.access(userId, c)).credits.available };
        const pass = await this.db.one(
          `SELECT * FROM package_grants WHERE user_id = $1 AND series_id = $2 AND kind = 'SEASON_PASS' AND status = 'ACTIVE'
             AND valid_until >= now() AND $3::timestamptz <= valid_until`, [userId, exam.series_id, exam.available_from], c);
        let grant = pass;
        if (!pass) {
          const g = await this.db.one(
            `SELECT * FROM package_grants WHERE user_id = $1 AND series_id = $2 AND kind = 'CREDITS' AND status = 'ACTIVE'
               AND credits_used < credits_total AND valid_until >= now() ORDER BY valid_until, created_at LIMIT 1 FOR UPDATE`,
            [userId, exam.series_id], c);
          if (!g) throw new AppError('NO_ACCESS', 'Kamu belum punya kredit atau Lifetime untuk periode ini.');
          if (!useCredit) {
            const left = (await this.access(userId, c)).credits.available;
            throw new AppError('CREDIT_CONFIRMATION_REQUIRED', 'Konfirmasi pemakaian 1 kredit.', [{ field: 'useCredit', message: `Kreditmu ${left} → ${left - 1}.` }]);
          }
          await c.query('UPDATE package_grants SET credits_used = credits_used + 1 WHERE id = $1', [g.id]);
          grant = g;
        }
        const ent = await this.db.one(
          `INSERT INTO entitlements (user_id, exam_id, source, package_grant_id, max_attempts, valid_until)
           VALUES ($1, $2, 'PACKAGE', $3, $4, LEAST($5::timestamptz, $6::timestamptz)) RETURNING *`,
          [userId, examId, grant.id, exam.max_attempts, exam.available_until, grant.valid_until], c);
        return { entitlement: entDto(ent), created: true, creditsRemaining: (await this.access(userId, c)).credits.available };
      });
    } catch (e: any) {
      // Penukaran bersamaan: unique index menolak yang kedua; transaksinya di-rollback (kredit tidak terpakai)
      if (e?.code === '23505') {
        const ent = await this.db.one(`SELECT * FROM entitlements WHERE user_id = $1 AND exam_id = $2 AND source = 'PACKAGE'`, [userId, examId]);
        if (ent) return { entitlement: entDto(ent), created: false, creditsRemaining: (await this.access(userId)).credits.available };
      }
      throw e;
    }
  }

  private simulatorEnabled = async (c?: Tx) =>
    process.env.NODE_ENV !== 'production' && (await this.settings.get('payments.dev_simulator_enabled', false, c)) === true;

  /** EP-ORD-01 — TDD 6.7.1 */
  async createOrder(userId: string, productId: string, voucherId: string | null | undefined) {
    return this.db.tx(async (c) => {
      await this.assertReady(c, userId);
      const p = await this.db.one('SELECT * FROM products WHERE id = $1 AND is_package FOR SHARE', [productId], c);
      if (!p || p.status !== 'ACTIVE') throw new AppError('PRODUCT_NOT_PURCHASABLE', 'Paket ini sedang tidak dijual.');
      const season = await this.db.one('SELECT * FROM exam_series WHERE id = $1', [p.series_id], c);
      if (!season?.exam_date) throw new AppError('NO_ACTIVE_SEASON', 'Penjualan musim ini belum dibuka karena tanggal SNBT belum ditetapkan.');
      if (p.product_type === 'LIFETIME') {
        const has = await this.db.one(
          `SELECT 1 FROM package_grants WHERE user_id = $1 AND series_id = $2 AND kind = 'SEASON_PASS' AND status = 'ACTIVE'`, [userId, p.series_id], c);
        if (has) throw new AppError('SEASON_PASS_EXISTS', 'Kamu sudah punya Lifetime untuk musim ini.');
      }
      // FR-PAY-12 (1): order PENDING yang sama dikembalikan
      const pending = await this.db.one(
        `SELECT o.id FROM orders o JOIN order_items i ON i.order_id = o.id
          WHERE o.user_id = $1 AND i.product_id = $2 AND o.status = 'PENDING' AND o.expires_at > now() LIMIT 1`, [userId, productId], c);
      if (pending) return { orderId: pending.id as string, reused: true };
      const subtotal = Number(p.price_amount);
      let discount = 0;
      if (voucherId) {
        const v = await this.db.one(`SELECT * FROM vouchers WHERE id = $1 AND user_id = $2 FOR UPDATE`, [voucherId, userId], c);
        if (!v || v.status !== 'AVAILABLE' || new Date(v.expires_at) < new Date()) {
          throw new AppError('VOUCHER_NOT_AVAILABLE', 'Voucher ini tidak dapat dipakai.');
        }
        discount = Math.floor((subtotal * v.percent_off) / 100);
      }
      const number = `CV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const o = await this.db.one(
        `INSERT INTO orders (order_number, user_id, subtotal_amount, discount_amount, total_amount, expires_at, voucher_id)
         VALUES ($1,$2,$3,$4,$5, now() + interval '24 hours', $6) RETURNING *`,
        [number, userId, subtotal, discount, subtotal - discount, voucherId ?? null], c);
      await c.query(
        `INSERT INTO order_items (order_id, product_id, product_type, product_name, unit_price, line_total, tryout_credits, series_id)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7)`, [o!.id, p.id, p.product_type, p.name, subtotal, p.tryout_credits, p.series_id]);
      if (voucherId) await c.query(`UPDATE vouchers SET status = 'RESERVED', reserved_order_id = $2 WHERE id = $1`, [voucherId, o!.id]);
      if (!(await this.simulatorEnabled(c))) {
        // Gateway produksi belum dipilih (OQ-T1)
        throw new AppError('PRODUCT_NOT_PURCHASABLE', 'Pembayaran belum tersedia. Coba lagi nanti.');
      }
      await c.query(
        `INSERT INTO payments (order_id, provider, provider_order_id, amount, expires_at, checkout_url)
         VALUES ($1, 'DEV_SIMULATED', $2, $3, $4, $5)`,
        [o!.id, number, subtotal - discount, o!.expires_at, `${config.webOrigin}/app/pesanan/${o!.id}`]);
      return { orderId: o!.id as string, reused: false };
    });
  }

  async order(userId: string, orderId: string) {
    const o = await this.db.one('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [orderId, userId]);
    if (!o) throw notFound();
    const item = await this.db.one('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
    const pay = await this.db.one('SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1', [orderId]);
    const grant = await this.db.one('SELECT * FROM package_grants WHERE order_item_id = $1', [item?.id ?? null]);
    return {
      order: {
        id: o.id, orderNumber: o.order_number, status: o.status, subtotalAmount: Number(o.subtotal_amount),
        discountAmount: Number(o.discount_amount), totalAmount: Number(o.total_amount), expiresAt: iso(o.expires_at),
        paidAt: iso(o.paid_at), createdAt: iso(o.created_at), voucherApplied: !!o.voucher_id,
      },
      item: item ? { productId: item.product_id, type: item.product_type, name: item.product_name, tryoutCredits: item.tryout_credits } : null,
      payment: pay ? { provider: pay.provider, status: pay.status, simulator: pay.provider === 'DEV_SIMULATED' && (await this.simulatorEnabled()) } : null,
      grant: grant ? { kind: grant.kind, creditsTotal: grant.credits_total, validUntil: iso(grant.valid_until) } : null,
    };
  }

  async orders(userId: string) {
    const r = await this.db.query(
      `SELECT o.*, i.product_name, i.product_type FROM orders o JOIN order_items i ON i.order_id = o.id
        WHERE o.user_id = $1 ORDER BY o.created_at DESC`, [userId]);
    return r.rows.map((o) => ({ id: o.id, orderNumber: o.order_number, status: o.status, productName: o.product_name, type: o.product_type,
      totalAmount: Number(o.total_amount), createdAt: iso(o.created_at), expiresAt: iso(o.expires_at), paidAt: iso(o.paid_at) }));
  }

  /** EP-PAY-04 — simulator; jalur penerapan sama dengan webhook (applyPaid). */
  async devPay(userId: string, orderId: string, outcome: 'SETTLED' | 'FAILED') {
    if (!(await this.simulatorEnabled())) throw notFound();
    return this.db.tx(async (c) => {
      const o = await this.db.one('SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE', [orderId, userId], c);
      if (!o) throw notFound();
      if (o.status === 'PAID') return { status: 'PAID' };
      if (o.status !== 'PENDING' || new Date(o.expires_at) < new Date()) throw new AppError('PRODUCT_NOT_PURCHASABLE', 'Pesanan ini sudah tidak dapat dibayar.');
      if (outcome === 'FAILED') {
        await c.query(`UPDATE payments SET status = 'FAILED', failed_at = now(), failure_reason = 'Simulasi gagal' WHERE order_id = $1 AND status = 'PENDING'`, [orderId]);
        return { status: 'PENDING' };
      }
      await c.query(`UPDATE payments SET status = 'SETTLED', settled_at = now(), payment_method = 'SIMULATOR' WHERE order_id = $1 AND status IN ('PENDING','FAILED')`, [orderId]);
      await this.applyPaid(c, orderId);
      return { status: 'PAID' };
    });
  }

  /** TDD 6.7.1 applyPaid — idempotent; dipakai webhook gateway (kelak) dan simulator. */
  async applyPaid(c: Tx, orderId: string) {
    const o = await this.db.one('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId], c);
    if (!o || o.status === 'PAID') return;
    await c.query(`UPDATE orders SET status = 'PAID', paid_at = now() WHERE id = $1`, [orderId]);
    const days = Number(await this.settings.get('lifetime.days_before_exam', 7, c));
    const items = (await this.db.query(
      `SELECT i.*, s.exam_date FROM order_items i JOIN exam_series s ON s.id = i.series_id WHERE i.order_id = $1`, [orderId], c)).rows;
    for (const i of items) {
      if (i.product_type === 'LIFETIME') {
        await c.query(
          `INSERT INTO package_grants (user_id, order_item_id, kind, series_id, valid_until)
           VALUES ($1, $2, 'SEASON_PASS', $3, ${endOfDayWib('$4::date - $5::int')}) ON CONFLICT (order_item_id) DO NOTHING`,
          [o.user_id, i.id, i.series_id, i.exam_date, days]);
      } else {
        await c.query(
          `INSERT INTO package_grants (user_id, order_item_id, kind, series_id, credits_total, valid_until)
           VALUES ($1, $2, 'CREDITS', $3, $4, ${endOfDayWib('$5::date')}) ON CONFLICT (order_item_id) DO NOTHING`,
          [o.user_id, i.id, i.series_id, i.tryout_credits, i.exam_date]);
      }
    }
    if (o.voucher_id) await c.query(`UPDATE vouchers SET status = 'USED', used_order_id = $2, used_at = now(), reserved_order_id = NULL WHERE id = $1`, [o.voucher_id, orderId]);
    await this.refs.qualify(c, o.user_id, orderId);
  }

  /** FR-PAY-05: kedaluwarsa order; voucher yang dipesan kembali tersedia (FR-REF-05 (3)). */
  async expireOrders() {
    await this.db.tx(async (c) => {
      const r = await c.query(
        `UPDATE orders SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < now() RETURNING id, voucher_id`);
      for (const o of r.rows) {
        await c.query(`UPDATE payments SET status = 'EXPIRED' WHERE order_id = $1 AND status = 'PENDING'`, [o.id]);
        if (o.voucher_id) await c.query(`UPDATE vouchers SET status = 'AVAILABLE', reserved_order_id = NULL WHERE id = $1 AND status = 'RESERVED'`, [o.voucher_id]);
      }
    });
  }

  async cancel(userId: string, orderId: string) {
    return this.db.tx(async (c) => {
      const o = await this.db.one(`SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE`, [orderId, userId], c);
      if (!o) throw notFound();
      if (o.status !== 'PENDING') return { status: o.status };
      await c.query(`UPDATE orders SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'Dibatalkan siswa' WHERE id = $1`, [orderId]);
      await c.query(`UPDATE payments SET status = 'EXPIRED' WHERE order_id = $1 AND status = 'PENDING'`, [orderId]);
      if (o.voucher_id) await c.query(`UPDATE vouchers SET status = 'AVAILABLE', reserved_order_id = NULL WHERE id = $1 AND status = 'RESERVED'`, [o.voucher_id]);
      return { status: 'CANCELLED' };
    });
  }
}

const entDto = (x: any) => ({ id: x.id, examId: x.exam_id, source: x.source, status: x.status,
  attemptsRemaining: x.max_attempts - x.attempts_used, validUntil: iso(x.valid_until) });
export const dateOnly = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10)
  : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);

@Controller()
export class CommerceController {
  constructor(private commerce: Commerce) {}

  /** EP-PKG-01 */
  @Public() @Get('packages')
  packages() { return this.commerce.packages(); }

  /** EP-PKG-02 */
  @Roles('STUDENT') @Get('users/me/access')
  access(@CurrentUser() me: AuthUser) { return this.commerce.access(me.id); }

  /** EP-PKG-03 */
  @Roles('STUDENT') @Post('exams/:examId/redeem')
  async redeem(@CurrentUser() me: AuthUser, @Param('examId') examId: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    rateLimit(`redeem:${me.id}`, 20, 60e3);
    const r = await this.commerce.redeem(me.id, examId, !!parse(redeemSchema, body).useCredit);
    res.status(r.created ? 201 : 200);
    return r;
  }

  /** EP-ORD-01 */
  @Roles('STUDENT') @Post('orders')
  async create(@CurrentUser() me: AuthUser, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    rateLimit(`order:${me.id}`, 10, 60e3);
    const input = parse(createOrderSchema, body);
    const r = await this.commerce.createOrder(me.id, input.productId, input.voucherId);
    res.status(r.reused ? 200 : 201);
    return this.commerce.order(me.id, r.orderId);
  }

  /** EP-ORD-02 */
  @Roles('STUDENT') @Get('users/me/orders')
  async list(@CurrentUser() me: AuthUser) { return { data: await this.commerce.orders(me.id) }; }

  /** EP-ORD-03 */
  @Roles('STUDENT') @Get('orders/:id')
  order(@CurrentUser() me: AuthUser, @Param('id') id: string) { return this.commerce.order(me.id, id); }

  @Roles('STUDENT') @Post('orders/:id/cancel') @HttpCode(200)
  cancel(@CurrentUser() me: AuthUser, @Param('id') id: string) { return this.commerce.cancel(me.id, id); }

  /** EP-PAY-04 — simulator pengembangan (TD-12) */
  @Roles('STUDENT') @Post('orders/:id/dev-pay') @HttpCode(200)
  async devPay(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    await this.commerce.devPay(me.id, id, parse(devPaySchema, body).outcome);
    return this.commerce.order(me.id, id);
  }
}

/** EP-PKG-04..06 */
@Controller('admin/packages') @Roles('EXAM_ADMIN')
export class PackagesAdminController {
  constructor(private db: Db) {}

  @Get()
  async list() {
    const r = await this.db.query(
      `SELECT p.*, s.name AS series_name, NULL::timestamptz AS valid_until,
              (SELECT count(*) FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.product_id = p.id AND o.status = 'PAID')::int AS sold
         FROM products p JOIN exam_series s ON s.id = p.series_id WHERE p.is_package ORDER BY s.created_at DESC, p.display_order`);
    return { data: r.rows.map((p) => ({ ...pkgDto(p), seriesName: p.series_name, sold: p.sold })) };
  }

  @Post()
  async create(@CurrentUser() me: AuthUser, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = parse(packageSchema, body);
    const credits = input.type === 'LIFETIME' ? null : (input.tryoutCredits ?? (input.type === 'SINGLE' ? 1 : 4));
    try {
      const p = await this.db.tx(async (c) => {
        const row = await this.db.one(
          `INSERT INTO products (slug, product_type, name, description, price_amount, status, created_by, is_package, tryout_credits, series_id, display_order)
           VALUES ($1,$2,$3,'',$4,'ACTIVE',$5,TRUE,$6,$7, CASE $2 WHEN 'SINGLE' THEN 1 WHEN 'BUNDLE' THEN 2 ELSE 3 END) RETURNING id`,
          [`paket-${input.type.toLowerCase()}-${crypto.randomBytes(3).toString('hex')}`, input.type, input.name, input.priceAmount, me.id, credits, input.seriesId], c);
        await audit(c, me, 'PACKAGE_CREATED', 'product', row!.id, null, { ...input, tryoutCredits: credits }, null);
        return row;
      });
      res.status(201);
      return { package: { id: p!.id } };
    } catch (e: any) {
      if (e?.code === '23505') throw new AppError('VALIDATION_FAILED', 'Paket jenis ini sudah aktif untuk musim tersebut.', [], 409);
      throw e;
    }
  }

  @Patch(':id')
  async update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(packagePatchSchema, body);
    return this.db.tx(async (c) => {
      const before = await this.db.one('SELECT * FROM products WHERE id = $1 AND is_package FOR UPDATE', [id], c);
      if (!before) throw notFound();
      await c.query(
        `UPDATE products SET name = COALESCE($2, name), price_amount = COALESCE($3, price_amount), status = COALESCE($4, status) WHERE id = $1`,
        [id, input.name ?? null, input.priceAmount ?? null, input.status ?? null]);
      await audit(c, me, 'PACKAGE_UPDATED', 'product', id, { name: before.name, priceAmount: Number(before.price_amount), status: before.status }, input, null);
      return { package: { id } };
    });
  }
}
