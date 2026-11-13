'use client';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, ButtonLink, Card, LoadingBlock, PageHeader, ProgressBar, Segmented, cx } from '@/components/ui';
import { SampleRoadmap } from '@/components/marketing';
import { TaskList, dayLabel, todayWib, type PlanDay } from '@/components/planner';
import { CLASS_LABEL } from '@/lib/labels';
import { api, fmt } from '@/lib/api';

const range = (a: string, b: string) => {
  const f = (d: string) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  return `${f(a)} – ${f(b)}`;
};

/** STU-14 Roadmap & Hari Ini (FR-RMP-01..07, wireframe 5.19). */
export default function Roadmap() {
  const [rm, setRm] = useState<any>(undefined);
  const [plan, setPlan] = useState<{ days: PlanDay[] } | null>(null);
  const [error, setError] = useState('');
  const [showWeek, setShowWeek] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError('');
    try {
      const r = await api('/users/me/roadmap');
      setRm(r);
      if (r.plan) setPlan(await api('/users/me/plan'));
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setMinutes(v: string) {
    setBusy(true);
    try { setRm(await api('/users/me/study-preferences', { method: 'PUT', body: { dailyMinutes: Number(v) } })); setPlan(await api('/users/me/plan')); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  if (error) return <Alert tone="danger" title="Roadmap gagal dimuat" action={<Button size="sm" variant="secondary" onClick={load}>Coba Lagi</Button>}>{error}</Alert>;
  if (rm === undefined) return <LoadingBlock />;
  if (!rm.plan) {
    return (
      <div className="mx-auto max-w-[720px] space-y-6">
        <PageHeader title="Roadmap belajar" />
        <Card variant="highlight">
          <h2 className="text-title-3 font-semibold">Roadmap muncul setelah try out pertamamu.</h2>
          <p className="mt-1 text-neutral-600">Ini contohnya. Roadmap-mu disusun dari jawabanmu sendiri.</p>
          <ButtonLink href="/app/tryout" className="mt-4">Lihat try out</ButtonLink>
        </Card>
        <SampleRoadmap className="bg-white" />
      </div>
    );
  }
  const p = rm.plan;
  const today = todayWib();
  const todayDay = plan?.days.find((d) => d.date === today);
  const rest = plan?.days.filter((d) => d.date !== today) ?? [];
  return (
    <div className="mx-auto max-w-[880px] space-y-6">
      <PageHeader title="Roadmap belajar"
        description={p.examDateKnown ? <><span className="tabular font-semibold text-neutral-900">{p.daysToExam} hari</span> lagi menuju SNBT ({fmt.date(`${p.examDate}T00:00:00+07:00`)}).</>
          : 'Tanggal SNBT belum diumumkan — roadmap disusun untuk 8 minggu.'} />
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-callout font-semibold">Waktu belajar per hari</span>
        <Segmented label="Waktu belajar per hari" value={String(p.dailyMinutes)} onChange={(v) => !busy && setMinutes(v)}
          options={[30, 60, 90, 120].map((m) => ({ value: String(m), label: `${m} mnt` }))} />
      </div>

      <Card aria-labelledby="hari-ini">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="hari-ini" className="text-title-3 font-semibold">Hari ini · {todayDay?.totalMinutes ?? 0} menit</h2>
          <span className="text-footnote text-neutral-600">{dayLabel(today)}</span>
        </div>
        <div className="mt-2">{plan ? <TaskList key={today + p.id} items={todayDay?.items ?? []} onChange={() => api('/users/me/roadmap').then(setRm)} /> : <LoadingBlock />}</div>
      </Card>

      <section>
        <button type="button" aria-expanded={showWeek} onClick={() => setShowWeek(!showWeek)} className="min-h-11 text-callout text-link hover:underline">
          {showWeek ? 'Sembunyikan' : 'Lihat'} 6 hari berikutnya <span aria-hidden="true">{showWeek ? '⌃' : '⌄'}</span>
        </button>
        {showWeek && (
          <div className="mt-3 space-y-4">
            {rest.map((d) => (
              <Card key={d.date} variant="muted">
                <p className="text-headline font-semibold">{dayLabel(d.date)} · {d.totalMinutes} menit</p>
                <div className="mt-1"><TaskList key={d.date + p.id} items={d.items} compact /></div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="fase">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="fase" className="text-title-2 font-bold">Fase per minggu</h2>
          <span className="tabular text-callout text-neutral-600">{p.progress.done} dari {p.progress.total} tugas selesai</span>
        </div>
        <p className="mt-1 text-callout text-neutral-600">Skor terakhir {p.currentScore}{p.targetScore != null && <> · target {p.targetScore}</>}. Disusun dari try out terakhirmu.</p>
        <ol className="mt-4 space-y-3">
          {p.phases.map((ph: any) => {
            const current = today >= ph.startDate && today <= ph.endDate;
            return (
              <li key={ph.week} className={cx('rounded-lg bg-white p-5', current && 'ring-2 ring-primary-600')}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-headline font-semibold">Minggu {ph.week} <span className="font-normal text-neutral-600">· {range(ph.startDate, ph.endDate)}</span></p>
                  <span className="flex items-center gap-2">{current && <Badge tone="info">Minggu ini</Badge>}{ph.kind === 'CONSOLIDATE' && <Badge tone="neutral">Pemantapan & simulasi</Badge>}</span>
                </div>
                <ul className="mt-3 space-y-2">
                  {ph.topics.map((t: any) => (
                    <li key={t.topicId} className="text-callout">
                      <span className="font-semibold">{t.name}</span>
                      {t.classification && <span className="ml-2"><Badge tone={CLASS_LABEL[t.classification][1]}>{CLASS_LABEL[t.classification][0]}</Badge></span>}
                      <p className="text-neutral-600">{t.reason} Target akurasi {Math.round(t.targetAccuracy * 100)}%.</p>
                    </li>
                  ))}
                </ul>
                {ph.progress.total > 0 && <ProgressBar className="mt-3" value={ph.progress.done} max={ph.progress.total} label={`${ph.progress.done} dari ${ph.progress.total} tugas`} />}
              </li>
            );
          })}
        </ol>
      </section>
      <p className="text-footnote text-neutral-600">Roadmap ini saran belajar berdasarkan hasil try out-mu, bukan jaminan kelulusan.</p>
    </div>
  );
}
