'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PublicShell } from '@/components/shells';
import { Alert, ButtonLink, CheckList } from '@/components/ui';
import { PackageCards } from '@/components/marketing';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { shortDate, type PackageItem, type PackagesResponse } from '@/lib/catalog';

/** PUB-05 Paket & Harga (redaksi 9.0.2). Guest → daftar; siswa tanpa target → onboarding; siswa lengkap → order → STU-04. */
export default function Packages() {
  const { me, loading } = useSession();
  const router = useRouter();
  const [data, setData] = useState<PackagesResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<ApiError | null>(null);
  const [voucher, setVoucher] = useState<{ id: string; percentOff: number } | null>(null);
  const [lifetime, setLifetime] = useState(false);
  const isStudent = !!me?.roles.includes('STUDENT');

  useEffect(() => { api<PackagesResponse>('/packages').then(setData).catch(() => setError('Harga sedang tidak dapat dimuat.')); }, []);
  useEffect(() => {
    if (!isStudent) return;
    api('/users/me/vouchers').then((r) => setVoucher(r.data.find((v: any) => v.status === 'AVAILABLE') ?? null)).catch(() => {});
    api('/users/me/access').then((a) => setLifetime(!!a.seasonPass)).catch(() => {});
  }, [isStudent]);

  async function choose(p: PackageItem) {
    if (!me) { router.push('/daftar?lanjut=/paket'); return; }
    if (!isStudent) return;
    if (!me.profileComplete || !me.hasTarget) { router.push('/app/onboarding?lanjut=/paket'); return; }
    setBusy(p.id); setActionErr(null);
    try {
      const r = await api('/orders', { method: 'POST', body: { productId: p.id, voucherId: voucher?.id ?? null } });
      router.push(`/app/pesanan/${r.order.id}`);
    } catch (e) { setActionErr(e as ApiError); setBusy(null); }
  }

  return (
    <PublicShell bleed>
      <section className="px-5 pb-10 pt-16 text-center md:pt-24">
        <h1 className="text-[36px]/10 font-bold tracking-[-0.015em] md:text-display">Pilih paket sesuai rencanamu</h1>
        <p className="mx-auto mt-5 max-w-2xl text-body text-neutral-600 md:text-[21px] md:leading-[30px]">
          Semua paket memberi Full Try Out yang sama, laporan lengkap, roadmap belajar, dan progres. Bedanya di jumlah periode.
        </p>
      </section>
      <section className="bg-neutral-50 px-5 py-12 md:py-16">
        <div className="mx-auto max-w-[980px] space-y-6">
          {voucher && <Alert tone="success" title={`Voucher referral ${voucher.percentOff}% siap dipakai`}>Diskon diterapkan otomatis pada paket yang kamu pilih.</Alert>}
          {actionErr && <Alert tone={actionErr.code === 'SEASON_PASS_EXISTS' ? 'info' : 'danger'}
            action={actionErr.code === 'EMAIL_NOT_VERIFIED' ? <ButtonLink href="/app" variant="secondary" size="sm">Ke Ringkasan</ButtonLink> : undefined}>
            {actionErr.message}</Alert>}
          {error ? <p className="text-center text-neutral-600">{error}</p> : !data || loading ? <p className="text-center text-neutral-600">Memuat…</p>
            : <PackageCards data={data} onChoose={isStudent || !me ? choose : undefined} busy={busy} owned={{ lifetime }} voucherPercent={voucher?.percentOff ?? null} />}
          <p className="text-center text-callout text-neutral-600">Perbedaan lain antar paket sedang kami siapkan.</p>
        </div>
      </section>
      <section className="px-5 py-16 md:py-20">
        <div className="mx-auto grid max-w-[980px] gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-title-3 font-semibold">Di semua paket</h2>
            <CheckList className="mt-4" items={['Full Try Out tujuh subtes dengan timer per subtes', 'Laporan lengkap: per subtes, per topik, cara mengerjakan', 'Pembahasan setiap soal', 'Roadmap belajar dan plan harian', 'Progres antar periode dan jarak ke target']} />
          </div>
          <div className="divide-y divide-neutral-200 border-y border-neutral-200">
            {[
              ['Apa itu periode?', 'Satu Full Try Out yang dibuka pada jadwal tertentu.'],
              ['Kapan kredit berakhir?', `Pada tanggal SNBT musim ini${data?.season?.creditsEndAt ? ` (${shortDate(data.season.creditsEndAt)})` : ''}.`],
              ['Apa arti Lifetime?', `Akses semua periode musim ini yang dibuka sampai ${data?.season?.lifetimeEndsAt ? shortDate(data.season.lifetimeEndsAt) : 'H-7 SNBT'}.`],
              ['Ada try out gratis?', 'Tidak. Daftar, memilih target, contoh laporan, dan kode referral gratis.'],
            ].map(([q, a]) => (
              <details key={q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">{q}<span aria-hidden="true" className="text-neutral-600 group-open:rotate-180">⌄</span></summary>
                <p className="mt-2 text-callout text-neutral-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-[980px] text-footnote text-neutral-600">Skor Cogniverse adalah estimasi internal pada skala 0–1000, tidak memakai metode penilaian resmi SNBT, dan bukan prediksi kelulusan.</p>
      </section>
    </PublicShell>
  );
}
