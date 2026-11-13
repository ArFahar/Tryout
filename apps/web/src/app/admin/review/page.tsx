'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, EmptyState, LoadingBlock, PageHeader } from '@/components/ui';
import { DIFFICULTY } from '@/components/question-bank';
import { api, fmt } from '@/lib/api';

/** ADM-05 Question Review — antrean (EP-REV-03). */
export default function ReviewQueue() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/reviews/queue').then((r) => setRows(r.data)).catch((e) => setError(e.message)); }, []);
  return (
    <>
      <PageHeader title="Review soal" description="Soal diurutkan dari pengajuan terlama. Anda tidak dapat memutuskan soal yang Anda tulis sendiri." />
      {error && <Alert tone="danger">{error}</Alert>}
      {!rows ? <LoadingBlock /> : rows.length === 0 ? <EmptyState title="Antrean kosong">Tidak ada soal yang menunggu review.</EmptyState> : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.versionId}>
              <Link href={`/admin/review/${r.versionId}`} className="block rounded-md border border-neutral-200 bg-white p-4 hover:border-neutral-300 hover:shadow-sm">
                <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
                  <span>{r.subjectName} · {r.topicName}</span>
                  {r.difficulty && <Badge>{DIFFICULTY[r.difficulty]}</Badge>}
                  {r.isResubmission && <Badge tone="info">Pengajuan ulang</Badge>}
                  {r.isOwn && <Badge tone="warning">Soal Anda</Badge>}
                </div>
                <p className="mt-1 line-clamp-2 font-medium text-neutral-800">{r.stemPlain}</p>
                <p className="mt-1 text-sm text-neutral-600">{r.authorName} · versi {r.versionNumber} · diajukan {fmt.dateTime(r.submittedAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
