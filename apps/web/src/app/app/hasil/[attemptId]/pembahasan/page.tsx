'use client';
import { Suspense, use, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Badge, ButtonLink, Card, EmptyState, LoadingBlock, PageHeader, Segmented, cx } from '@/components/ui';
import { RichContent } from '@/components/rich';
import { api, ApiError } from '@/lib/api';

const FILTERS = [['all', 'Semua'], ['incorrect', 'Salah'], ['unanswered', 'Kosong'], ['flagged', 'Ragu-ragu']] as const;
const OUTCOME: Record<string, [string, any, string]> = {
  CORRECT: ['Benar', 'success', '✓'], INCORRECT: ['Salah', 'danger', '✕'], UNANSWERED: ['Tidak dijawab', 'neutral', '–'],
};

function Review({ attemptId }: { attemptId: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const filter = sp.get('filter') ?? 'all';
  const topicId = sp.get('topik');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    setData(null);
    const q = new URLSearchParams({ filter, ...(topicId ? { topicId } : {}) });
    api(`/attempts/${attemptId}/review?${q}`).then(setData).catch(setError);
  }, [attemptId, filter, topicId]);
  const go = (f: string) => router.replace(`?${new URLSearchParams({ filter: f, ...(topicId ? { topik: topicId } : {}) })}`);
  const topicName = topicId ? data?.data[0]?.topicName : null;
  if (error) return <Alert tone={error.code === 'REVIEW_NOT_AVAILABLE_YET' ? 'info' : 'danger'}>{error.message}</Alert>;
  return (
    <>
      <PageHeader title="Pembahasan" back={{ href: `/app/hasil/${attemptId}`, label: 'Hasil' }} description={data?.exam.title} />
      {topicId && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-primary-50 px-4 py-3 text-callout text-primary-800">
          <span>Menampilkan soal topik <strong>{topicName ?? '…'}</strong> saja.</span>
          <ButtonLink href={`/app/hasil/${attemptId}/pembahasan`} variant="plain" size="sm">Tampilkan semua soal</ButtonLink>
        </div>
      )}
      <Segmented className="mb-6" label="Filter soal" value={filter} onChange={go}
        options={FILTERS.map(([k, l]) => ({ value: k, label: l, count: topicId ? undefined : data?.counts?.[k] }))} />
      {!data ? <LoadingBlock /> : data.data.length === 0 ? <EmptyState title="Tidak ada soal untuk filter ini" /> : (
        <ol className="space-y-4">
          {data.data.map((q: any) => {
            const [label, tone, icon] = OUTCOME[q.outcome];
            return (
              <li key={q.number}>
                <Card as="article" aria-labelledby={`q-${q.number}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 id={`q-${q.number}`} className="text-headline font-semibold">Soal {q.number} <span className="font-normal text-neutral-600">· {q.sectionName}{q.topicName ? ` · ${q.topicName}` : ''}</span></h2>
                    <div className="flex gap-2">
                      {q.isFlagged && <Badge tone="warning" icon={<span aria-hidden="true">⚑</span>}>Ragu-ragu</Badge>}
                      {q.isCorrected && <Badge tone="info">Kunci dikoreksi</Badge>}
                      <Badge tone={tone} icon={<span aria-hidden="true">{icon}</span>}>{label}</Badge>
                    </div>
                  </div>
                  <RichContent html={q.stemHtml} className="mt-3 max-w-[72ch] text-body-lg" />
                  <ul className="mt-4 space-y-2">
                    {q.options.map((o: any) => {
                      const mine = o.key === q.selectedOptionKey;
                      return (
                        <li key={o.key} className={cx('flex items-start gap-3 rounded-md px-4 py-3',
                          o.isCorrect ? 'border-2 border-success-700 bg-success-50' : mine ? 'border-2 border-danger-700 bg-danger-50' : 'border border-neutral-200')}>
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neutral-400 text-footnote font-semibold" aria-hidden="true">{o.key}</span>
                          <RichContent html={o.contentHtml} className="min-w-0 flex-1 pt-0.5" />
                          <span className="shrink-0 pt-0.5 text-sm font-medium">
                            {o.isCorrect && <span className="text-success-700">✓ Kunci</span>}
                            {mine && !o.isCorrect && <span className="text-danger-700">✕ Jawabanmu</span>}
                            {mine && o.isCorrect && <span className="sr-only">, jawabanmu</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-4 rounded-md bg-neutral-50 p-4">
                    <p className="text-callout font-semibold text-neutral-900">Pembahasan</p>
                    <RichContent html={q.explanationHtml} className="mt-1 text-neutral-700" />
                  </div>
                  <p className="mt-3 text-footnote text-neutral-600">Waktu di soal ini: {Math.round(q.timeSpentMs / 1000)} detik</p>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

/** STU-09 Pembahasan (FR-RES-03; gerbang BR-PUB-04 dievaluasi API). */
export default function ReviewPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  return <Suspense fallback={<LoadingBlock />}><Review attemptId={attemptId} /></Suspense>;
}
