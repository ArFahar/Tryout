'use client';
import { Badge, Button, ButtonLink, CheckList, cx } from './ui';
import { fmt } from '@/lib/api';
import { seasonYear, shortDate, type PackageItem, type PackagesResponse } from '@/lib/catalog';

/** Baris cakupan paket — "Lifetime" selalu dengan musim dan tanggal berakhir (BR-PKG-04). */
export function packageScope(p: PackageItem, season: PackagesResponse['season']) {
  const year = seasonYear(season?.examDate);
  if (p.type === 'LIFETIME') {
    return season?.lifetimeEndsAt
      ? `Semua periode SNBT ${year}, berlaku sampai ${shortDate(season.lifetimeEndsAt)}`
      : `Semua periode SNBT ${year} sampai H-7 SNBT`;
  }
  const n = p.tryoutCredits ?? 1;
  return `${n} periode pilihan${p.validUntil ? `, berlaku sampai ${shortDate(p.validUntil)}` : ''}`;
}

/** Kartu paket (PUB-01, PUB-05). `onChoose` mengaktifkan tombol pilih; tanpanya kartu menautkan ke /paket. */
export function PackageCards({ data, compact, onChoose, busy, owned, voucherPercent }: {
  data: PackagesResponse; compact?: boolean; onChoose?: (p: PackageItem) => void; busy?: string | null;
  owned?: { lifetime: boolean }; voucherPercent?: number | null;
}) {
  if (!data.data.length) return <p className="text-center text-neutral-600">Penjualan musim berikutnya belum dibuka.</p>;
  const single = data.data.find((p) => p.type === 'SINGLE');
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {data.data.map((p) => {
        // Label "Hemat" hanya bila harga per periode memang lebih rendah dari paket 1x (OQ-U12)
        const cheaper = p.pricePerPeriod != null && single && p.type !== 'SINGLE' && p.pricePerPeriod < single.priceAmount;
        const hasLifetime = p.type === 'LIFETIME' && owned?.lifetime;
        const discounted = voucherPercent ? p.priceAmount - Math.floor((p.priceAmount * voucherPercent) / 100) : null;
        return (
          <div key={p.id} className={cx('flex flex-col rounded-xl p-8', p.type === 'BUNDLE' ? 'bg-white ring-2 ring-primary-600' : 'bg-white')}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-title-3 font-semibold">{p.type === 'SINGLE' ? 'Try Out Umum (1x)' : p.name}</p>
              {cheaper && <Badge tone="info">Hemat</Badge>}
            </div>
            <p className="tabular mt-3 text-title-2 font-bold">
              {discounted != null && !hasLifetime ? <><span className="mr-2 text-headline font-normal text-neutral-600 line-through">{fmt.rupiah(p.priceAmount)}</span>{fmt.rupiah(discounted)}</> : fmt.rupiah(p.priceAmount)}
            </p>
            <p className="mt-2 text-callout text-neutral-700">{packageScope(p, data.season)}</p>
            {p.type === 'BUNDLE' && p.pricePerPeriod && <p className="tabular mt-1 text-footnote text-neutral-600">≈{fmt.rupiah(p.pricePerPeriod)} per periode</p>}
            {!compact && <CheckList className="mt-5 text-callout" items={['Laporan lengkap 6 bagian', 'Pembahasan setiap soal', 'Roadmap & plan harian', 'Progres vs target']} />}
            <div className="mt-auto pt-8">
              {hasLifetime ? <Badge tone="success">Sudah kamu miliki</Badge>
                : onChoose ? <Button className="w-full" loading={busy === p.id} disabled={!!busy} onClick={() => onChoose(p)}>Pilih {p.type === 'SINGLE' ? '1x' : p.name} — {fmt.rupiah(discounted ?? p.priceAmount)}</Button>
                  : <ButtonLink href="/paket" variant={p.type === 'BUNDLE' ? 'primary' : 'secondary'} className="w-full">Pilih {p.type === 'SINGLE' ? '1x' : p.name}</ButtonLink>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Contoh roadmap berlabel "Contoh" (FR-RMP-08); data ilustrasi, bukan data siswa. */
export function SampleRoadmap({ className }: { className?: string }) {
  return (
    <div className={cx('rounded-xl bg-neutral-50 p-6 text-left md:p-8', className)} aria-label="Contoh roadmap">
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-neutral-200 px-2.5 py-0.5 text-caption font-semibold uppercase text-neutral-700">Contoh roadmap</span>
        <span className="text-footnote text-neutral-600">Data ilustrasi</span>
      </div>
      <p className="mt-5 text-headline font-semibold">Minggu 1 · Statistika, Aljabar</p>
      <p className="text-footnote text-neutral-600">Alasan: di Statistika, 1 dari 4 soal benar</p>
      <div className="mt-4 rounded-lg bg-white p-4">
        <p className="text-callout font-semibold">Hari ini · 60 menit</p>
        <ul className="mt-3 space-y-2.5 text-callout">
          {[['Pelajari materi Statistika', 15], ['Ulangi pembahasan 3 soal Statistika', 9], ['Latihan Statistika', 36]].map(([t, m]) => (
            <li key={t as string} className="flex items-center gap-3">
              <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-md border border-neutral-400" />
              <span className="flex-1">{t}</span><span className="tabular text-neutral-600">{m} mnt</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
