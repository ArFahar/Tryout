'use client';
import Link from 'next/link';
import { useState } from 'react';
import { cx } from './ui';
import { api } from '@/lib/api';

export interface PlanItem {
  id: string; kind: 'GUIDE' | 'REVIEW' | 'PRACTICE' | 'TRYOUT'; title: string; detail: string; estMinutes: number;
  status: 'TODO' | 'DONE'; topic: { id: string; name: string } | null; link: string;
}
export interface PlanDay { date: string; totalMinutes: number; items: PlanItem[] }
export const KIND_LABEL: Record<PlanItem['kind'], string> = { GUIDE: 'Pelajari materi', REVIEW: 'Ulangi pembahasan', PRACTICE: 'Latihan', TRYOUT: 'Try out' };
export const dayLabel = (d: string, today?: string) => (d === today ? 'Hari ini'
  : new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)));
export const todayWib = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

/** Daftar tugas dengan centang (FR-RMP-04, EP-RMP-03): optimistik, kembali bila gagal. */
export function TaskList({ items, onChange, compact }: { items: PlanItem[]; onChange?: (items: PlanItem[]) => void; compact?: boolean }) {
  const [list, setList] = useState(items);
  const [err, setErr] = useState('');
  async function toggle(it: PlanItem) {
    const next = list.map((x) => (x.id === it.id ? { ...x, status: (x.status === 'DONE' ? 'TODO' : 'DONE') as PlanItem['status'] } : x));
    setList(next); setErr('');
    try {
      await api(`/users/me/plan/items/${it.id}`, { method: 'PATCH', body: { done: it.status !== 'DONE' } });
      onChange?.(next);
    } catch {
      setList(list); setErr('Perubahan belum tersimpan. Coba lagi.');
    }
  }
  if (!list.length) return <p className="text-callout text-neutral-600">Tidak ada tugas untuk hari ini.</p>;
  return (
    <>
      <ul className="divide-y divide-neutral-100">
        {list.map((it) => {
          const done = it.status === 'DONE';
          return (
            <li key={it.id} className="flex items-start gap-3 py-3">
              <button type="button" role="checkbox" aria-checked={done} aria-label={`Tandai selesai: ${it.title}`} onClick={() => toggle(it)}
                className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border', done ? 'border-primary-600 bg-primary-600 text-white' : 'border-neutral-400 bg-white')}>
                {done && <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-caption font-semibold uppercase text-neutral-600">{KIND_LABEL[it.kind]}</p>
                <Link href={it.link} className={cx('font-semibold hover:underline', done && 'text-neutral-600 line-through')}>{it.title}</Link>
                {!compact && <p className="mt-0.5 text-callout text-neutral-600">{it.detail}</p>}
              </div>
              <span className="tabular shrink-0 text-callout text-neutral-600">{it.estMinutes} mnt</span>
            </li>
          );
        })}
      </ul>
      {err && <p role="alert" className="mt-2 text-callout text-danger-700">{err}</p>}
    </>
  );
}
