'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PublicShell } from '@/components/shells';
import { Alert, Badge, Button, ButtonLink, Card, CheckList, Dialog, LoadingBlock, PageHeader } from '@/components/ui';
import { AccessBadge, STATE_LABEL, type Access, type PeriodExam } from '@/components/exam-card';
import { api, ApiError, fmt } from '@/lib/api';
import { useSession } from '@/lib/session';

/** PUB-04 Detail Try Out Periode (v3.0): aksi mengikuti akses — Mulai / Pakai 1 kredit / Pilih paket. */
export default function PeriodDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { me, loading: sessionLoading } = useSession();
  const router = useRouter();
  const [data, setData] = useState<{ exam: PeriodExam & { sections: any[] }; access: Access | null } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ before: number } | null>(null);
  const [actionErr, setActionErr] = useState<ApiError | null>(null);
  const load = useCallback(() => {
    api(`/catalog/products/${slug}`).then(setData).catch((e) => setError(e.status === 404 ? 'notfound' : e.message));
  }, [slug]);
  useEffect(() => { if (!sessionLoading) load(); }, [load, sessionLoading, me]);

  if (error === 'notfound') return <PublicShell><PageHeader title="Try out tidak ditemukan" back={{ href: '/katalog', label: 'Try Out' }} description="Periode ini tidak ada atau sudah tidak tersedia." /></PublicShell>;
  if (error) return <PublicShell><Alert tone="danger" title="Gagal memuat">{error}</Alert></PublicShell>;
  if (!data) return <PublicShell><LoadingBlock /></PublicShell>;
  const { exam, access } = data;
  const isStudent = !!me?.roles.includes('STUDENT');
  const open = exam.periodState === 'OPEN';

  async function redeem(useCredit: boolean) {
    setBusy(true); setActionErr(null);
    try {
      await api(`/exams/${exam.id}/redeem`, { method: 'POST', body: { useCredit } });
      router.push(`/app/ujian/${exam.id}/instruksi`);
    } catch (e) {
      const ae = e as ApiError;
      if (ae.code === 'CREDIT_CONFIRMATION_REQUIRED') {
        const acc = await api('/users/me/access').catch(() => null);
        setConfirm({ before: acc?.credits.available ?? 1 });
      } else setActionErr(ae);
      setBusy(false);
    }
  }

  let cta: React.ReactNode;
  if (!me) {
    cta = <>
      <ButtonLink href={`/daftar?lanjut=/katalog/${slug}`} size="lg" className="w-full">Daftar Gratis</ButtonLink>
      <p className="text-center text-callout text-neutral-600">Sudah punya akun? <a className="text-link hover:underline" href={`/masuk?lanjut=/katalog/${slug}`}>Masuk</a></p>
    </>;
  } else if (!isStudent) {
    cta = <Alert tone="info">Anda masuk sebagai staf. Try out hanya untuk akun siswa.</Alert>;
  } else if (access?.kind === 'ENTITLED') {
    cta = access.state === 'IN_PROGRESS' ? <ButtonLink href={`/app/ujian/${exam.id}/instruksi`} size="lg" className="w-full">Lanjutkan</ButtonLink>
      : access.state === 'READY' ? <ButtonLink href={`/app/ujian/${exam.id}/instruksi`} size="lg" className="w-full">Mulai</ButtonLink>
        : access.lastAttemptId ? <ButtonLink href={`/app/hasil/${access.lastAttemptId}`} size="lg" className="w-full">Lihat Hasil</ButtonLink>
          : <Alert tone="info">Akses periode ini sudah berakhir.</Alert>;
  } else if (!open) {
    cta = <Alert tone="info">{exam.periodState === 'UPCOMING' ? `Periode ini dibuka ${fmt.dateTime(exam.availableFrom)}.` : 'Periode ini sudah ditutup.'}</Alert>;
  } else if (access?.kind === 'SEASON_PASS') {
    cta = <Button size="lg" className="w-full" loading={busy} onClick={() => redeem(false)}>Mulai</Button>;
  } else if (access?.kind === 'CREDIT_AVAILABLE') {
    cta = <>
      <Button size="lg" className="w-full" loading={busy} onClick={() => setConfirm({ before: access.credits })}>Pakai 1 kredit</Button>
      <p className="text-center text-callout text-neutral-600">Kamu punya {access.credits} kredit.</p>
    </>;
  } else {
    cta = <>
      <ButtonLink href="/paket" size="lg" className="w-full">Pilih paket</ButtonLink>
      <p className="text-center text-callout text-neutral-600">Kamu belum punya kredit atau Lifetime. Mulai Rp35.000.</p>
    </>;
  }

  return (
    <PublicShell>
      <PageHeader title={exam.title} back={{ href: '/katalog', label: 'Try out' }}
        description={<span className="mt-1 flex flex-col gap-3">
          <span className="flex flex-wrap gap-2"><Badge tone={open ? 'info' : 'neutral'}>Periode {exam.periodNumber} · {STATE_LABEL[exam.periodState]}</Badge><AccessBadge access={access} /></span>
          <span className="tabular text-body text-neutral-700">{exam.totalQuestions} soal · {Math.round(exam.totalDurationSeconds / 60)} menit · {exam.series.name}</span>
        </span>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <h2 className="text-title-3 font-semibold">Yang kamu dapat</h2>
            <CheckList className="mt-4" items={['Skor total dan skor per subtes', 'Analisis semua topik: kuat, cukup, dan perlu ditingkatkan, masing-masing dengan bukti', 'Cara mengerjakan: waktu per subtes, soal kosong, akurasi per kesulitan, perubahan jawaban', 'Roadmap belajar dan plan harian yang diperbarui dari hasil ini', 'Pembahasan setiap soal']} />
          </Card>
          <Card>
            <p className="text-neutral-700">{exam.description}</p>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[['Jumlah soal', `${exam.totalQuestions}`], ['Subtes', `${exam.sectionCount}`], ['Durasi', fmt.duration(exam.totalDurationSeconds)], ['Kesempatan', `${exam.maxAttempts}×`]].map(([k, v]) => (
                <div key={k}><dt className="text-footnote text-neutral-600">{k}</dt><dd className="tabular text-title-3 font-semibold">{v}</dd></div>
              ))}
            </dl>
          </Card>
          <Card>
            <h2 className="text-title-3 font-semibold">Susunan subtes</h2>
            <p className="mt-1 text-callout text-neutral-600">
              {exam.timingMode === 'PER_SECTION' ? 'Setiap subtes punya timer sendiri dan dikerjakan berurutan. Subtes yang sudah berakhir tidak dapat dibuka kembali.' : 'Satu timer untuk seluruh ujian.'}
            </p>
            <table className="mt-4 w-full text-left text-callout">
              <thead className="border-b border-neutral-200 text-neutral-600"><tr><th className="py-2 font-normal">Subtes</th><th className="py-2 text-right font-normal">Soal</th>{exam.timingMode === 'PER_SECTION' && <th className="py-2 text-right font-normal">Durasi</th>}</tr></thead>
              <tbody>
                {exam.sections.map((s: any) => (
                  <tr key={s.position} className="border-b border-neutral-100">
                    <td className="py-2.5">{s.position}. {s.name}</td><td className="tabular py-2.5 text-right">{s.questionCount}</td>
                    {exam.timingMode === 'PER_SECTION' && <td className="tabular py-2.5 text-right">{s.durationMinutes} menit</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p className="text-footnote text-neutral-600">Skor Cogniverse adalah estimasi internal pada skala 0–1000, tidak memakai metode penilaian resmi SNBT, dan bukan prediksi kelulusan.</p>
        </div>
        <aside>
          <Card className="space-y-4 lg:sticky lg:top-24">
            <p className="text-callout text-neutral-600">{open ? `Terbuka sampai ${fmt.dateTime(exam.availableUntil)}` : exam.periodState === 'UPCOMING' ? `Dibuka ${fmt.dateTime(exam.availableFrom)}` : 'Periode sudah ditutup'}</p>
            {actionErr?.code === 'EMAIL_NOT_VERIFIED' && <Alert tone="warning" title="Verifikasi email dulu">{actionErr.message}</Alert>}
            {actionErr?.code === 'TARGET_REQUIRED' && <Alert tone="warning" title="Pilih target dulu" action={<ButtonLink href={`/app/onboarding?lanjut=/katalog/${slug}`} variant="secondary" size="sm">Lengkapi target</ButtonLink>}>{actionErr.message}</Alert>}
            {actionErr?.code === 'NO_ACCESS' && <Alert tone="info" action={<ButtonLink href="/paket" size="sm">Pilih paket</ButtonLink>}>{actionErr.message}</Alert>}
            {actionErr && !['EMAIL_NOT_VERIFIED', 'TARGET_REQUIRED', 'NO_ACCESS'].includes(actionErr.code) && <Alert tone="danger">{actionErr.message}</Alert>}
            {cta}
          </Card>
        </aside>
      </div>
      <Dialog open={!!confirm} title="Pakai 1 kredit?" onClose={() => setConfirm(null)}
        footer={<><Button variant="secondary" data-autofocus onClick={() => setConfirm(null)}>Batal</Button>
          <Button loading={busy} onClick={() => { setConfirm(null); redeem(true); }}>Ya, Pakai Kredit</Button></>}>
        <p>Kreditmu <span className="tabular font-semibold">{confirm?.before} → {(confirm?.before ?? 1) - 1}</span>. Kredit yang sudah dipakai tidak bisa dikembalikan.</p>
      </Dialog>
    </PublicShell>
  );
}
