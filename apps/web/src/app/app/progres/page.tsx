'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, ButtonLink, Card, EmptyState, LoadingBlock, PageHeader, Select, cx } from '@/components/ui';
import { TargetForm } from '@/components/target-form';
import { api, fmt } from '@/lib/api';

/** Grafik garis skor total (6.7.12): sumbu 0–1000 penuh, titik dapat difokus, tabel padanan untuk pembaca layar. */
function TrendChart({ points, target }: { points: { attemptId: string; examTitle: string; takenAt: string; totalScore: number }[]; target?: number | null }) {
  const W = 640, H = 220, P = { l: 40, r: 16, t: 16, b: 28 };
  const IN = 28; // jarak dalam agar titik tidak menimpa label sumbu
  const x = (i: number) => P.l + IN + (points.length === 1 ? (W - P.l - P.r - 2 * IN) / 2 : (i * (W - P.l - P.r - 2 * IN)) / (points.length - 1));
  const y = (v: number) => P.t + (1 - v / 1000) * (H - P.t - P.b);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Tren skor total; rinciannya ada di tabel di bawah">
        {[0, 250, 500, 750, 1000].map((v) => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--color-neutral-100)" />
            <text x={P.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--color-neutral-600)">{v}</text>
          </g>
        ))}
        {target != null && (
          <g aria-hidden="true">
            <line x1={P.l} x2={W - P.r} y1={y(target)} y2={y(target)} stroke="var(--color-neutral-400)" strokeDasharray="6 5" strokeWidth="1.5" />
            <text x={W - P.r} y={y(target) - 6} textAnchor="end" fontSize="11" fill="var(--color-neutral-700)">target {target}</text>
          </g>
        )}
        <polyline fill="none" stroke="var(--color-primary-600)" strokeWidth="2" points={points.map((p, i) => `${x(i)},${y(p.totalScore)}`).join(' ')} />
        {points.map((p, i) => (
          <g key={p.attemptId} tabIndex={0} aria-label={`Try out #${i + 1}, ${fmt.date(p.takenAt)}, skor ${Math.round(p.totalScore)}`} className="focus:outline-none [&:focus>circle]:stroke-[3]">
            <circle cx={x(i)} cy={y(p.totalScore)} r="5" fill="white" stroke="var(--color-primary-600)" strokeWidth="2" />
            <text x={x(i)} y={y(p.totalScore) - 10} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--color-neutral-900)">{Math.round(p.totalScore)}</text>
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--color-neutral-600)">#{i + 1}</text>
          </g>
        ))}
      </svg>
      <table className="sr-only">
        <caption>Skor total per try out</caption>
        <thead><tr><th>Try out</th><th>Tanggal</th><th>Skor</th></tr></thead>
        <tbody>{points.map((p, i) => <tr key={p.attemptId}><td>#{i + 1} {p.examTitle}</td><td>{fmt.date(p.takenAt)}</td><td>{Math.round(p.totalScore)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

const DIR: Record<string, [string, string, string]> = {
  UP: ['▲', 'Naik', 'text-success-700'], DOWN: ['▼', 'Turun', 'text-danger-700'], SAME: ['■', 'Relatif sama', 'text-neutral-600'],
};

/** STU-13 Progres (P1; EP-PRG-01/02). Hanya attempt dalam seri yang sama yang dibandingkan (BR-PRG-01/02). */
export default function Progress() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [pair, setPair] = useState<[string, string] | null>(null);
  const [cmp, setCmp] = useState<any>(null);
  const [targets, setTargets] = useState<any>(null);
  const [editTarget, setEditTarget] = useState(false);
  const loadTargets = () => api('/users/me/targets').then(setTargets).catch(() => {});
  const load = () => { setError(''); loadTargets(); api('/users/me/progress').then((d) => { setData(d); setSeriesId(d.series[0]?.id ?? ''); }).catch((e) => setError(e.message)); };
  useEffect(load, []);
  const s = data?.series.find((x: any) => x.id === seriesId);
  useEffect(() => {
    if (!s || s.attempts.length < 2) { setPair(null); return; }
    setPair([s.attempts[s.attempts.length - 2].attemptId, s.attempts[s.attempts.length - 1].attemptId]);
  }, [s]);
  useEffect(() => {
    if (!pair) { setCmp(null); return; }
    setCmp(null);
    api(`/users/me/progress/compare?a=${pair[0]}&b=${pair[1]}`).then(setCmp).catch((e) => setCmp({ comparable: false, reason: e.message }));
  }, [pair]);

  if (error) return <Alert tone="danger" action={<Button size="sm" variant="secondary" onClick={load}>Coba Lagi</Button>}>{error}</Alert>;
  if (!data) return <LoadingBlock />;
  const enough = data.series.some((x: any) => x.attempts.length >= 2);
  return (
    <div className="mx-auto max-w-[980px]">
      <PageHeader title="Progres & target" description="Periode dalam satu musim disusun setara, jadi perbandingannya adil." />
      {targets && (() => {
        const t1 = targets.targets.find((x: any) => x.priority === 1);
        const t2 = targets.targets.find((x: any) => x.priority === 2);
        return (
          <Card className="mb-6" aria-labelledby="target">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="target" className="text-title-3 font-semibold">Target</h2>
              <Button variant="plain" size="sm" onClick={() => setEditTarget(!editTarget)}>{editTarget ? 'Batal' : 'Ubah target'}</Button>
            </div>
            {editTarget ? <div className="mt-4"><TargetForm submitLabel="Simpan Target" showMinutes={false} onDone={() => { setEditTarget(false); loadTargets(); }} /></div> : t1 ? (
              <>
                <p className="mt-2 font-semibold">{t1.program} · <span className="font-normal">{t1.university}</span></p>
                {t2 && <p className="text-callout text-neutral-600">Pilihan kedua: {t2.program} · {t2.university}</p>}
                <p className="tabular mt-3">Target pribadi <strong>{t1.personalTargetScore ?? '—'}</strong> · skor terbaru <strong>{targets.latest?.score ?? '—'}</strong>
                  {targets.gap != null && <> · {targets.gap > 0 ? `kurang ${targets.gap} poin` : 'target tercapai'}</>}</p>
                <p className="mt-2 text-footnote text-neutral-600">
                  {t1.reference ? `Acuan ${t1.reference.source}, ${t1.reference.year}: ${t1.reference.score}. Skala sumber berbeda dengan skor Cogniverse, jadi tidak dibandingkan langsung.`
                    : 'Data acuan untuk program ini belum tersedia.'}
                </p>
              </>
            ) : <p className="mt-2 text-callout text-neutral-600">Belum ada target.</p>}
          </Card>
        );
      })()}
      {!enough && (
        <EmptyState title={data.series.some((x: any) => x.attempts.length === 1) ? 'Kerjakan periode berikutnya untuk melihat tren.' : 'Progres muncul setelah try out pertamamu.'}
          action={<ButtonLink href="/app/tryout">Lihat try out</ButtonLink>}>
          Periode dalam satu musim disusun setara, jadi perbandingannya adil.
        </EmptyState>
      )}
      {data.series.length > 0 && (
        <div className="space-y-6">
          {data.series.length > 1 && (
            <label className="block max-w-sm"><span className="text-callout font-semibold">Seri</span>
              <Select className="mt-1.5" value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
                {data.series.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </label>
          )}
          {s && (
            <section className="rounded-xl bg-white p-6 md:p-8" aria-labelledby="tren">
              <h2 id="tren" className="text-title-3 font-semibold">{s.name}</h2>
              <p className="mt-1 text-callout text-neutral-600">{s.attempts.length} try out dikerjakan</p>
              <div className="mt-6"><TrendChart points={s.attempts} target={targets?.targets.find((x: any) => x.priority === 1)?.personalTargetScore ?? null} /></div>
              {s.sections.length > 0 && (
                <div className="mt-8">
                  <h3 className="text-headline font-semibold">Per subtes</h3>
                  <ul className="mt-3 divide-y divide-neutral-100">
                    {s.sections.map((sec: any) => (
                      <li key={sec.position} className="flex flex-wrap justify-between gap-2 py-3 text-callout">
                        <span>{sec.label}</span>
                        <span className="tabular text-neutral-700">{sec.points.map((p: any) => Math.round(p.score)).join(' → ')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
          {s && s.attempts.length >= 2 && pair && (
            <section className="rounded-xl bg-white p-6 md:p-8" aria-labelledby="banding">
              <h2 id="banding" className="text-title-3 font-semibold">Bandingkan dua try out</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[0, 1].map((k) => (
                  <label key={k} className="block"><span className="text-callout font-semibold">{k === 0 ? 'Sebelumnya' : 'Sesudahnya'}</span>
                    <Select className="mt-1.5" value={pair[k]} onChange={(e) => setPair(k === 0 ? [e.target.value, pair[1]] : [pair[0], e.target.value])}>
                      {s.attempts.map((a: any, i: number) => <option key={a.attemptId} value={a.attemptId}>#{i + 1} {a.examTitle} · {fmt.date(a.takenAt)}</option>)}
                    </Select>
                  </label>
                ))}
              </div>
              {!cmp ? <div className="mt-6"><LoadingBlock /></div> : !cmp.comparable ? <Alert tone="info" className="mt-6">{cmp.reason}</Alert> : (
                <table className="mt-6 w-full text-left text-callout">
                  <thead className="border-b border-neutral-200 text-footnote text-neutral-600">
                    <tr><th className="py-2 font-normal">Bagian</th><th className="py-2 text-right font-normal">Sebelumnya</th><th className="py-2 text-right font-normal">Sesudahnya</th><th className="py-2 pl-4 font-normal">Perubahan</th></tr>
                  </thead>
                  <tbody>
                    {cmp.rows.map((r: any) => {
                      const [ic, lbl, cls] = DIR[r.direction];
                      const v = (n: number) => (r.unit === 'score' ? Math.round(n) : fmt.pct(n));
                      return (
                        <tr key={`${r.scopeType}-${r.label}`} className="border-b border-neutral-100">
                          <td className="py-2.5">{r.label}</td>
                          <td className="tabular py-2.5 text-right">{v(r.a)}</td>
                          <td className="tabular py-2.5 text-right">{v(r.b)}</td>
                          <td className={cx('py-2.5 pl-4', cls)}><span aria-hidden="true">{ic} </span>{lbl}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <p className="mt-4 text-footnote text-neutral-600">Selisih kecil (kurang dari 50 poin skor atau 10 poin persentase akurasi) ditandai &quot;Relatif sama&quot;.</p>
            </section>
          )}
          {data.unseriesAttempts.length > 0 && (
            <section aria-labelledby="tidak-dibandingkan">
              <h2 id="tidak-dibandingkan" className="text-headline font-semibold">Tidak dibandingkan</h2>
              <p className="mt-1 text-callout text-neutral-600">Try out berikut tidak termasuk seri, jadi soal dan tingkat kesulitannya tidak setara dengan try out lain.</p>
              <ul className="mt-3 space-y-2">
                {data.unseriesAttempts.map((a: any) => (
                  <li key={a.attemptId} className="flex justify-between gap-4 rounded-lg bg-white px-5 py-3 text-callout">
                    <Link href={`/app/hasil/${a.attemptId}`} className="text-link hover:underline">{a.examTitle}</Link>
                    <span className="tabular text-neutral-600">{fmt.date(a.takenAt)} · {Math.round(a.totalScore)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
