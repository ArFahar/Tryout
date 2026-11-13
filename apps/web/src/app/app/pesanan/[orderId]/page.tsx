'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, ButtonLink, Card, LoadingBlock, PageHeader, cx } from '@/components/ui';
import { api, ApiError, fmt } from '@/lib/api';
import { shortDate } from '@/lib/catalog';

const STATUS: Record<string, [string, any]> = {
  PENDING: ['Menunggu pembayaran', 'warning'], PAID: ['Berhasil', 'success'], EXPIRED: ['Kedaluwarsa', 'neutral'],
  CANCELLED: ['Dibatalkan', 'neutral'], REFUNDED: ['Dikembalikan', 'neutral'],
};

/** STU-04 Checkout (FR-PAY-01..06, FR-PKG-03, FR-REF-05). Status selalu dibaca dari server (FR-PAY-04). */
export default function Checkout({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => api(`/orders/${orderId}`).then(setD).catch(setError), [orderId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (d?.order.status !== 'PENDING') return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [d?.order.status, load]);
  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!d) return <LoadingBlock />;
  const { order, item, payment, grant } = d;
  const step = order.status === 'PAID' ? 3 : 2;

  async function act(path: string, body?: any, key = path) {
    setBusy(key);
    try { setD(await api(path, { method: 'POST', body })); } catch (e) { setError(e as ApiError); } finally { setBusy(null); load(); }
  }

  return (
    <div className="mx-auto max-w-[640px]">
      <PageHeader title="Checkout" back={{ href: '/paket', label: 'Paket' }} />
      <ol className="mb-6 flex gap-2 text-footnote" aria-label="Langkah checkout">
        {['Ringkasan', 'Pembayaran', 'Selesai'].map((s, i) => (
          <li key={s} aria-current={i + 1 === step ? 'step' : undefined}
            className={cx('flex-1 rounded-full px-3 py-1.5 text-center', i + 1 <= step ? 'bg-primary-600 font-semibold text-white' : 'bg-neutral-100 text-neutral-600')}>{s}</li>
        ))}
      </ol>
      {order.status === 'PAID' ? (
        <Card variant="highlight" className="text-center">
          <h2 className="text-title-2 font-bold">Pembayaran berhasil.</h2>
          <p className="mt-2 text-neutral-600">{grant?.kind === 'SEASON_PASS' ? `Lifetime aktif sampai ${shortDate(grant.validUntil)}.` : `Kamu punya ${grant?.creditsTotal ?? item?.tryoutCredits} kredit baru, berlaku sampai ${shortDate(grant?.validUntil)}.`}</p>
          <ButtonLink href="/app/tryout" size="lg" className="mt-6">Pilih try out</ButtonLink>
        </Card>
      ) : (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-title-3 font-semibold">{item?.type === 'SINGLE' ? 'Try Out Umum (1x)' : item?.name}</p>
              <p className="mt-1 text-callout text-neutral-600">{item?.type === 'LIFETIME' ? 'Semua periode musim ini sampai H-7 SNBT' : `${item?.tryoutCredits} periode pilihan`}</p>
            </div>
            <Badge tone={STATUS[order.status][1]}>{STATUS[order.status][0]}</Badge>
          </div>
          <dl className="tabular mt-6 space-y-2 border-t border-neutral-200 pt-4 text-callout">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{fmt.rupiah(order.subtotalAmount)}</dd></div>
            {order.discountAmount > 0 && <div className="flex justify-between text-success-700"><dt>Voucher referral</dt><dd>− {fmt.rupiah(order.discountAmount)}</dd></div>}
            <div className="flex justify-between text-headline font-semibold"><dt>Total</dt><dd>{fmt.rupiah(order.totalAmount)}</dd></div>
          </dl>
          <p className="mt-3 text-footnote text-neutral-600">No. pesanan {order.orderNumber} · bayar sebelum {fmt.dateTime(order.expiresAt)}</p>
          {order.status === 'PENDING' ? (
            <div className="mt-6 space-y-4">
              {payment?.simulator ? (
                <div className="rounded-lg border-[1.5px] border-dashed border-neutral-400 p-4">
                  <p className="text-caption font-semibold uppercase text-neutral-600">Simulator pembayaran — hanya pengembangan</p>
                  <p className="mt-1 text-callout text-neutral-600">Penyedia pembayaran belum dipilih (OQ-T1). Tombol ini tidak tersedia di produksi.</p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Button loading={busy === 'ok'} disabled={!!busy} onClick={() => act(`/orders/${orderId}/dev-pay`, { outcome: 'SETTLED' }, 'ok')}>Bayar — {fmt.rupiah(order.totalAmount)}</Button>
                    <Button variant="secondary" loading={busy === 'fail'} disabled={!!busy} onClick={() => act(`/orders/${orderId}/dev-pay`, { outcome: 'FAILED' }, 'fail')}>Simulasikan gagal</Button>
                  </div>
                  {payment.status === 'FAILED' && <p className="mt-3 text-callout text-danger-700">Pembayaran gagal. Coba lagi.</p>}
                </div>
              ) : <Alert tone="info">Pembayaran belum tersedia.</Alert>}
              <Button variant="plain" size="sm" loading={busy === 'cancel'} onClick={() => act(`/orders/${orderId}/cancel`, undefined, 'cancel')}>Batalkan pesanan</Button>
            </div>
          ) : (
            <div className="mt-6">
              <p className="text-neutral-600">{order.status === 'EXPIRED' ? 'Waktu pembayaran habis. Voucher kamu kembali tersedia.' : 'Pesanan ini dibatalkan.'}</p>
              <ButtonLink href="/paket" className="mt-4">Pilih paket lagi</ButtonLink>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
