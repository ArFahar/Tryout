'use client';
import Link from 'next/link';
import { Badge } from './ui';
import { fmt } from '@/lib/api';

export type PeriodState = 'OPEN' | 'UPCOMING' | 'CLOSED';
export type Access =
  | { kind: 'ENTITLED'; state: string; entitlementId: string; lastAttemptId: string | null; attemptsRemaining: number }
  | { kind: 'SEASON_PASS'; validUntil: string }
  | { kind: 'CREDIT_AVAILABLE'; credits: number }
  | { kind: 'NONE' };
export interface PeriodExam {
  id: string; slug: string; title: string; description: string; examType: 'FULL_TRYOUT';
  series: { id: string; name: string; examDate: string | null };
  periodNumber: number; periodState: PeriodState;
  deliveryMode: 'ON_DEMAND' | 'SCHEDULED'; timingMode: 'TOTAL' | 'PER_SECTION'; totalQuestions: number; sectionCount: number;
  totalDurationSeconds: number; maxAttempts: number; availableFrom: string | null; availableUntil: string | null;
  access: Access | null;
}
export interface Season { id: string; name: string; examDate: string | null; lifetimeEndsAt: string | null }

export const STATE_LABEL: Record<PeriodState, string> = { OPEN: 'Terbuka', UPCOMING: 'Akan datang', CLOSED: 'Selesai' };

/** Badge akses (UI/UX 6.7.7 v3.0). */
export function AccessBadge({ access }: { access: Access | null }) {
  if (!access) return null;
  if (access.kind === 'ENTITLED') return <Badge tone="success">{access.state === 'COMPLETED' ? 'Sudah dikerjakan' : 'Sudah dimiliki'}</Badge>;
  if (access.kind === 'SEASON_PASS') return <Badge tone="info">Termasuk Lifetime</Badge>;
  if (access.kind === 'CREDIT_AVAILABLE') return <Badge tone="neutral">Bisa pakai kredit</Badge>;
  return <Badge tone="neutral">Belum punya akses</Badge>;
}

/** Kartu periode (6.7.3 interactive): seluruh kartu satu target fokus. */
export function PeriodCard({ exam }: { exam: PeriodExam }) {
  return (
    <Link href={`/katalog/${exam.slug}`} className="lift group flex flex-col rounded-lg bg-white p-6">
      <div className="flex flex-wrap gap-2">
        <Badge tone={exam.periodState === 'OPEN' ? 'info' : 'neutral'}>Periode {exam.periodNumber} · {STATE_LABEL[exam.periodState]}</Badge>
        <AccessBadge access={exam.access} />
      </div>
      <h3 className="mt-4 text-title-3 font-semibold text-neutral-900">{exam.title}</h3>
      <p className="tabular mt-2 text-callout text-neutral-700">
        {exam.totalQuestions} soal · {fmt.duration(exam.totalDurationSeconds)}{exam.timingMode === 'PER_SECTION' && ' · timer per subtes'}
      </p>
      <p className="mt-1 text-footnote text-neutral-600">
        {exam.periodState === 'UPCOMING' ? `Dibuka ${fmt.dateTime(exam.availableFrom)}` : `Terbuka sampai ${fmt.dateTime(exam.availableUntil)}`}
      </p>
      <span className="mt-auto pt-6 text-callout text-link group-hover:underline">Lihat detail <span aria-hidden="true">›</span></span>
    </Link>
  );
}

/** Badge tipe try out — sejak v3.0 hanya Full Try Out (dipertahankan untuk riwayat dan laporan). */
export function ExamTypeBadge(_: { type: string }) {
  return <Badge tone="neutral">Full Try Out</Badge>;
}
