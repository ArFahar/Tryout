'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, ButtonLink, Card, LoadingBlock, PageHeader } from '@/components/ui';
import { SampleRoadmap } from '@/components/marketing';
import { TaskList, todayWib, type PlanDay } from '@/components/planner';
import type { PeriodExam } from '@/components/exam-card';
import { api, fmt } from '@/lib/api';
import { shortDate } from '@/lib/catalog';
import { useSession } from '@/lib/session';

const left = (iso?: string | null) => {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
};

/** STU-02 Ringkasan (redaksi 9.0.3 v3.0): satu langkah utama, Hari Ini, Target, Akses. */
export default function Overview() {
  const { me } = useSession();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    Promise.all([api('/users/me/entitlements'), api('/catalog/products'), api('/users/me/targets'), api('/users/me/roadmap'), api('/users/me/plan?days=1')])
      .then(([e, c, t, r, p]) => setD({ ents: e.data, access: e.access, periods: c.data as PeriodExam[], targets: t, roadmap: r.plan, today: (p.days as PlanDay[])[0] ?? null }))
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);
  if (error) return <Alert tone="danger" title="Ringkasan gagal dimuat" action={<Button size="sm" variant="secondary" onClick={load}>Coba Lagi</Button>}>{error}</Alert>;
  if (!d) return <LoadingBlock />;

  const hasAccess = !!d.access.seasonPass || d.access.credits.available > 0;
  const inProgress = d.ents.find((e: any) => e.state === 'IN_PROGRESS');
  const ready = d.ents.find((e: any) => e.state === 'READY');
  const openNew = d.periods.find((e: PeriodExam) => e.periodState === 'OPEN' && (e.access?.kind === 'SEASON_PASS' || e.access?.kind === 'CREDIT_AVAILABLE'));
  const t1 = d.targets.targets.find((x: any) => x.priority === 1);

  let primary: React.ReactNode;
  if (inProgress) {
    primary = <Card variant="highlight">
      <h2 className="text-title-2 font-bold">Ujianmu masih berjalan</h2>
      <p className="mt-2 text-neutral-600">{inProgress.exam.title}. Waktu tersisa <span className="tabular font-semibold text-neutral-900">{left(inProgress.activeAttempt?.sectionDeadlineAt ?? inProgress.activeAttempt?.expiresAt)}</span>. Timer tidak berhenti.</p>
      <ButtonLink href={`/app/ujian/${inProgress.exam.id}/instruksi`} size="lg" className="mt-6">Lanjutkan Ujian</ButtonLink>
    </Card>;
  } else if (ready) {
    primary = <Card variant="highlight">
      <p className="text-callout text-neutral-600">Siap dikerjakan</p>
      <h2 className="mt-1 text-title-2 font-bold">{ready.exam.title}</h2>
      <p className="mt-2 text-neutral-600">Sisa kesempatan {ready.attemptsRemaining} · berlaku sampai {fmt.dateTime(ready.validUntil)}</p>
      <ButtonLink href={`/app/ujian/${ready.exam.id}/instruksi`} size="lg" className="mt-6">Mulai</ButtonLink>
    </Card>;
  } else if (openNew) {
    primary = <Card variant="highlight">
      <h2 className="text-title-2 font-bold">Periode {openNew.periodNumber} sudah dibuka</h2>
      <p className="mt-2 text-neutral-600">{openNew.title}. {openNew.access?.kind === 'SEASON_PASS' ? 'Sudah termasuk Lifetime-mu.' : `Pakai 1 dari ${(openNew.access as any).credits} kreditmu.`}</p>
      <ButtonLink href={`/katalog/${openNew.slug}`} size="lg" className="mt-6">{openNew.access?.kind === 'SEASON_PASS' ? 'Mulai' : 'Pakai 1 kredit'}</ButtonLink>
    </Card>;
  } else if (!hasAccess && !d.roadmap) {
    primary = <Card variant="highlight">
      <h2 className="text-title-2 font-bold">Pilih paket untuk mulai</h2>
      <p className="mt-2 text-neutral-600">Try out mulai Rp35.000. Laporan, roadmap, dan progres termasuk di semua paket.</p>
      <ButtonLink href="/paket" size="lg" className="mt-6">Lihat paket</ButtonLink>
    </Card>;
  } else {
    primary = <Card variant="highlight">
      <h2 className="text-title-2 font-bold">Ikuti roadmap-mu</h2>
      <p className="mt-2 text-neutral-600">Selesaikan tugas hari ini sambil menunggu periode berikutnya.</p>
      <ButtonLink href="/app/roadmap" size="lg" className="mt-6">Buka roadmap</ButtonLink>
    </Card>;
  }

  return (
    <>
      <PageHeader title={`Halo, ${me?.fullName.split(' ')[0]}`} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {primary}
          {d.roadmap ? (
            <Card aria-labelledby="hari-ini">
              <div className="flex items-baseline justify-between gap-2">
                <h2 id="hari-ini" className="text-title-3 font-semibold">Hari ini · {d.today?.totalMinutes ?? 0} menit</h2>
                <ButtonLink href="/app/roadmap" variant="link" size="sm">Lihat roadmap</ButtonLink>
              </div>
              <div className="mt-2"><TaskList key={todayWib()} items={d.today?.items ?? []} compact /></div>
            </Card>
          ) : <SampleRoadmap className="bg-white" />}
        </div>
        <aside className="space-y-6">
          <Card>
            <h2 className="text-title-3 font-semibold">Target</h2>
            {t1 ? (
              <>
                <p className="mt-2 font-semibold">{t1.program}</p>
                <p className="text-callout text-neutral-600">{t1.university}</p>
                <dl className="tabular mt-4 grid grid-cols-2 gap-3">
                  <div><dt className="text-footnote text-neutral-600">Skor terbaru</dt><dd className="text-title-3 font-semibold">{d.targets.latest?.score ?? '—'}</dd></div>
                  <div><dt className="text-footnote text-neutral-600">Target</dt><dd className="text-title-3 font-semibold">{t1.personalTargetScore ?? '—'}</dd></div>
                </dl>
                <p className="mt-3 text-callout text-neutral-600">
                  {d.targets.gap != null ? (d.targets.gap > 0 ? `Kurang ${d.targets.gap} poin.` : 'Target pribadimu sudah tercapai.')
                    : t1.personalTargetScore == null ? 'Isi target skor agar jaraknya terlihat.' : 'Kerjakan try out untuk melihat jaraknya.'}
                </p>
              </>
            ) : <p className="mt-2 text-callout text-neutral-600">Belum ada target.</p>}
            <ButtonLink href="/app/progres" variant="link" className="mt-2">Lihat progres</ButtonLink>
          </Card>
          <Card variant="muted">
            <h2 className="text-headline font-semibold">Akses</h2>
            <p className="mt-1 text-callout text-neutral-600">
              {d.access.seasonPass ? `Lifetime sampai ${shortDate(d.access.seasonPass.validUntil)}.` : d.access.credits.available > 0 ? `${d.access.credits.available} kredit tersisa.` : 'Belum punya kredit atau Lifetime.'}
            </p>
            <ButtonLink href="/app/referral" variant="link" className="mt-2">Ajak 3 teman, dapat diskon 20%</ButtonLink>
          </Card>
        </aside>
      </div>
    </>
  );
}
