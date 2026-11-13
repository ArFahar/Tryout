'use client';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, LoadingBlock, PageHeader, ProgressBar } from '@/components/ui';
import { api } from '@/lib/api';
import { shortDate } from '@/lib/catalog';

const V_STATUS: Record<string, [string, any]> = {
  AVAILABLE: ['Siap dipakai', 'success'], RESERVED: ['Sedang dipakai di pesanan', 'warning'], USED: ['Sudah dipakai', 'neutral'], EXPIRED: ['Kedaluwarsa', 'neutral'],
};

/** STU-17 Referral (FR-REF-01..06): hanya hitungan, tanpa identitas teman. */
export default function Referral() {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { api('/users/me/referral').then(setD).catch((e) => setError(e.message)); }, []);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!d) return <LoadingBlock />;
  const progress = d.qualified % d.threshold;
  async function copy() {
    try { await navigator.clipboard.writeText(d.shareUrl); setCopied(true); setTimeout(() => setCopied(false), 3000); } catch { /* izin clipboard ditolak */ }
  }
  return (
    <div className="mx-auto max-w-[720px] space-y-6">
      <PageHeader title="Ajak teman" description={`Setiap ${d.threshold} teman yang membeli paket dengan kodemu memberimu voucher diskon ${d.percentOff}%.`} />
      <Card>
        <p className="text-footnote text-neutral-600">Kode kamu</p>
        <p className="tabular mt-1 text-title-1 font-bold tracking-[0.08em]">{d.code}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <code className="min-w-0 flex-1 truncate rounded-md bg-neutral-50 px-3 py-2.5 text-callout">{d.shareUrl}</code>
          <Button onClick={copy}>{copied ? 'Tautan tersalin' : 'Salin tautan'}</Button>
        </div>
        <p role="status" className="sr-only">{copied ? 'Tautan tersalin' : ''}</p>
      </Card>
      <Card>
        <h2 className="text-title-3 font-semibold">Voucher berikutnya</h2>
        <p className="mt-2"><span className="tabular font-semibold">{progress} dari {d.threshold}</span> teman sudah membeli. {d.nextVoucherIn} lagi untuk voucher berikutnya.</p>
        <ProgressBar className="mt-3" value={progress} max={d.threshold} label={`${progress} dari ${d.threshold}`} />
        <dl className="tabular mt-5 grid grid-cols-2 gap-4 text-callout">
          <div><dt className="text-footnote text-neutral-600">Teman terdaftar</dt><dd className="text-title-3 font-semibold">{d.registered}</dd></div>
          <div><dt className="text-footnote text-neutral-600">Sudah membeli paket</dt><dd className="text-title-3 font-semibold">{d.qualified}</dd></div>
        </dl>
        <p className="mt-4 text-footnote text-neutral-600">Teman dihitung setelah pembelian paket pertamanya berhasil. Nama dan email temanmu tidak ditampilkan.</p>
      </Card>
      <Card>
        <h2 className="text-title-3 font-semibold">Voucher kamu</h2>
        {d.vouchers.length === 0 ? <p className="mt-2 text-neutral-600">Belum ada voucher.</p> : (
          <ul className="mt-3 divide-y divide-neutral-100">
            {d.vouchers.map((v: any) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="font-semibold">Diskon {v.percentOff}%</span>
                <span className="flex items-center gap-3 text-footnote text-neutral-600">berlaku sampai {shortDate(v.expiresAt)} <Badge tone={V_STATUS[v.status][1]}>{V_STATUS[v.status][0]}</Badge></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
