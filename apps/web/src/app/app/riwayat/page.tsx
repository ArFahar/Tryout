'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, ButtonLink, EmptyState, LoadingBlock, PageHeader } from '@/components/ui';
import { ExamTypeBadge } from '@/components/exam-card';
import { api, fmt } from '@/lib/api';

const STATUS: Record<string, [string, any]> = {
  IN_PROGRESS: ['Sedang berlangsung', 'primary'], SUBMITTED: ['Sedang dinilai', 'info'], SCORED: ['Selesai', 'success'], VOIDED: ['Dibatalkan admin', 'neutral'],
};

/** STU-10 Exam History */
export default function History() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const load = () => { setError(''); api('/users/me/attempts').then((r) => setRows(r.data)).catch((e) => setError(e.message)); };
  useEffect(load, []);
  return (
    <>
      <PageHeader title="Riwayat ujian" />
      {error ? <Alert tone="danger" action={<Button size="sm" variant="secondary" onClick={load}>Coba Lagi</Button>}>{error}</Alert>
        : !rows ? <LoadingBlock />
          : rows.length === 0 ? <EmptyState title="Belum ada riwayat" action={<ButtonLink href="/katalog">Buka Katalog</ButtonLink>}>Ujian yang sudah kamu kerjakan akan muncul di sini.</EmptyState>
            : (
              <ul className="space-y-3">
                {rows.map((a) => (
                  <li key={a.id}>
                    <Link href={a.status === 'IN_PROGRESS' ? '/app/asesmen' : `/app/hasil/${a.id}`}
                      className="flex items-center justify-between gap-4 rounded-md border border-neutral-200 bg-white p-4 hover:border-neutral-300 hover:shadow-sm sm:p-6">
                      <div className="min-w-0">
                        <div className="flex flex-wrap gap-2"><ExamTypeBadge type={a.exam.examType} /><Badge tone={STATUS[a.status][1]}>{STATUS[a.status][0]}</Badge></div>
                        <p className="mt-2 font-medium">{a.exam.title}{a.attemptNumber > 1 && ` · percobaan ke-${a.attemptNumber}`}</p>
                        <p className="text-sm text-neutral-600">{fmt.dateTime(a.submittedAt ?? a.startedAt)}{a.submissionType === 'AUTO_TIMEOUT' && ' · dikumpulkan otomatis'}</p>
                      </div>
                      {a.totalScore !== null && <p className="shrink-0 text-right"><span className="text-2xl font-bold tabular">{a.totalScore}</span><span className="block text-xs text-neutral-600">dari 1000</span></p>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
    </>
  );
}
