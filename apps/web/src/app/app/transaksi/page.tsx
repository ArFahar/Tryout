'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, EmptyState, LoadingBlock, PageHeader, ButtonLink } from '@/components/ui';
import { api, fmt } from '@/lib/api';

const STATUS: Record<string, [string, any]> = {
  PENDING: ['Menunggu pembayaran', 'warning'], PAID: ['Berhasil', 'success'], EXPIRED: ['Kedaluwarsa', 'neutral'],
  CANCELLED: ['Dibatalkan', 'neutral'], REFUNDED: ['Dikembalikan', 'neutral'],
};

/** STU-12 Riwayat Transaksi (FR-PAY-06): menunggu pembayaran di atas. */
export default function Transactions() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/users/me/orders').then((r) => setRows(r.data)).catch((e) => setError(e.message)); }, []);
  const sorted = (rows ?? []).slice().sort((a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING'));
  return (
    <div className="mx-auto max-w-[720px]">
      <PageHeader title="Transaksi" />
      {error ? <Alert tone="danger">{error}</Alert> : !rows ? <LoadingBlock />
        : rows.length === 0 ? <EmptyState title="Belum ada transaksi." action={<ButtonLink href="/paket">Lihat paket</ButtonLink>} />
          : (
            <ul className="space-y-3">
              {sorted.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-5 py-4">
                  <div>
                    <p className="font-semibold">{o.type === 'SINGLE' ? 'Try Out Umum (1x)' : o.productName}</p>
                    <p className="text-footnote text-neutral-600">{o.orderNumber} · {fmt.dateTime(o.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular font-semibold">{fmt.rupiah(o.totalAmount)}</span>
                    <Badge tone={STATUS[o.status][1]}>{STATUS[o.status][0]}</Badge>
                    {o.status === 'PENDING' ? <ButtonLink href={`/app/pesanan/${o.id}`} size="sm">Lanjutkan Pembayaran</ButtonLink>
                      : <Link href={`/app/pesanan/${o.id}`} className="text-callout text-link hover:underline">Detail</Link>}
                  </div>
                </li>
              ))}
            </ul>
          )}
    </div>
  );
}
