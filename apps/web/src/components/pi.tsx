'use client';
import React, { useEffect, useId, useRef, useState } from 'react';
import { ButtonLink, LoadingBlock, cx } from './ui';
import { api } from '@/lib/api';

export interface Insight {
  id: string; dimension: string; kind: 'OBSERVATION' | 'INFERENCE'; ruleCode: string; classification: string | null;
  topicId: string | null; text: string; basedOn: string | null; basis: string | null; hasEvidence: boolean;
}

const EyeIcon = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
);
const QIcon = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 17.5h.01" strokeLinecap="round" /></svg>
);

/** Kartu insight (6.7.13): PENGAMATAN = garis penuh + ikon mata; DUGAAN = garis putus-putus + ikon tanya + "Berdasarkan". */
export function InsightCard({ insight, onEvidence }: { insight: Insight; onEvidence?: (i: Insight) => void }) {
  const inf = insight.kind === 'INFERENCE';
  return (
    <article className={cx('rounded-lg bg-white p-5', inf ? 'border-[1.5px] border-dashed border-neutral-400' : 'border border-neutral-200')}>
      <p className="flex items-center gap-1.5 text-caption font-semibold uppercase text-neutral-600">
        {inf ? <QIcon /> : <EyeIcon />}{inf ? 'Dugaan' : 'Pengamatan'}
      </p>
      <p className="mt-2 text-body text-neutral-900">{emphasize(insight.text)}</p>
      {inf && insight.basis && <p className="mt-2 text-footnote text-neutral-600">Berdasarkan: {insight.basis}</p>}
      {insight.hasEvidence && onEvidence && (
        <button type="button" onClick={() => onEvidence(insight)} className="mt-3 min-h-11 text-callout text-link hover:underline">
          Lihat bukti <span aria-hidden="true">›</span>
        </button>
      )}
    </article>
  );
}

/** Menebalkan angka dasar "x dari y" (5.9.5: satu pernyataan, satu bukti). */
export function emphasize(text: string) {
  const parts = text.split(/(\d+ dari \d+)/g);
  return parts.map((p, i) => (/^\d+ dari \d+$/.test(p) ? <strong key={i} className="tabular font-semibold">{p}</strong> : <React.Fragment key={i}>{p}</React.Fragment>));
}

const DIFF: Record<string, string> = { EASY: 'Mudah', MEDIUM: 'Sedang', HARD: 'Sulit' };
const OUT: Record<string, [string, string, string]> = {
  CORRECT: ['✓', 'Benar', 'text-success-700'], INCORRECT: ['✕', 'Salah', 'text-danger-700'], UNANSWERED: ['–', 'Kosong', 'text-neutral-600'],
};
const mmss = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Lembar bukti (5.9.4): panel samping 420 px (desktop) / lembar bawah (mobile). Tanpa kunci jawaban (TC-PI-10). */
export function EvidenceSheet({ attemptId, insight, onClose }: { attemptId: string; insight: Insight | null; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!insight) return;
    setData(null); setError('');
    api(`/attempts/${attemptId}/insights/${insight.id}`).then(setData).catch((e) => setError(e.message));
  }, [attemptId, insight]);
  useEffect(() => {
    if (!insight) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [insight, onClose]);
  if (!insight) return null;
  const inf = insight.kind === 'INFERENCE';
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/30 md:items-stretch" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-xl bg-white p-6 shadow-lg md:max-h-none md:w-[420px] md:rounded-none">
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-title-3 font-semibold">Bukti</h2>
          <button type="button" onClick={onClose} aria-label="Tutup" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-neutral-100">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
          </button>
        </div>
        <p className="mt-4 text-caption font-semibold uppercase text-neutral-600">{inf ? 'Dugaan' : 'Pengamatan'}</p>
        <p className="mt-1">{emphasize(insight.text)}</p>
        {error ? <p className="mt-6 text-callout text-danger-700">{error}</p> : !data ? <div className="mt-6"><LoadingBlock /></div> : (
          <>
            {data.basedOn && <p className="mt-2 text-footnote text-neutral-600">Berdasarkan: {data.basedOn.text}</p>}
            {data.evidence.questions.length > 0 ? (
              <table className="mt-6 w-full text-left text-callout">
                <caption className="sr-only">Soal yang mendasari temuan ini</caption>
                <thead className="border-b border-neutral-200 text-footnote text-neutral-600">
                  <tr><th className="py-2 font-normal">No</th><th className="py-2 font-normal">Subtes</th><th className="py-2 font-normal">Kesulitan</th><th className="py-2 font-normal">Hasil</th><th className="py-2 text-right font-normal">Waktu</th></tr>
                </thead>
                <tbody>
                  {data.evidence.questions.map((q: any) => {
                    const o = q.outcome ? OUT[q.outcome] : null;
                    return (
                      <tr key={q.number} className="border-b border-neutral-100">
                        <td className="tabular py-2.5">{q.number}</td>
                        <td className="py-2.5">{abbr(q.sectionName)}</td>
                        <td className="py-2.5">{DIFF[q.difficulty] ?? '—'}</td>
                        <td className={cx('py-2.5', o?.[2])}>{o ? <><span aria-hidden="true">{o[0]} </span>{o[1]}</> : '—'}</td>
                        <td className="tabular py-2.5 text-right">{mmss(q.timeSpentMs)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <dl className="mt-6 space-y-2 text-callout">
                {Object.entries(data.evidence.metrics).filter(([, v]) => typeof v !== 'object').map(([k, v]) => (
                  <div key={k} className="flex justify-between"><dt className="text-neutral-600">{METRIC[k] ?? k}</dt><dd className="tabular">{fmtMetric(k, v)}</dd></div>
                ))}
              </dl>
            )}
            {data.evidence.questions.some((q: any) => q.outcome === null) && (
              <p className="mt-3 text-footnote text-neutral-600">Hasil per soal tampil setelah pembahasan dibuka.</p>
            )}
            <div className="mt-6">
              <ButtonLink href={`/app/hasil/${attemptId}/pembahasan${insight.topicId ? `?topik=${insight.topicId}` : ''}`} className="w-full">Pelajari soal-soal ini</ButtonLink>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const METRIC: Record<string, string> = { usedSeconds: 'Waktu terpakai', allottedSeconds: 'Waktu tersedia', correct: 'Benar', incorrect: 'Salah', unanswered: 'Kosong', hi: 'Skor tertinggi', lo: 'Skor terendah' };
function fmtMetric(k: string, v: any) {
  if (k.endsWith('Seconds')) return mmss(Number(v) * 1000);
  return String(v);
}
/** Singkatan subtes untuk tabel sempit. */
export function abbr(name: string) {
  return name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('') || name;
}
