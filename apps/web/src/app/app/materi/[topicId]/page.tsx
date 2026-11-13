'use client';
import { Suspense, use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, Button, ButtonLink, Card, CheckList, LoadingBlock, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';

function Guide({ topicId }: { topicId: string }) {
  const task = useSearchParams().get('tugas');
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api(`/topics/${topicId}/guide`).then(setD).catch((e) => setError(e.message));
    api('/users/me/roadmap').then((r) => setAttemptId(r.plan?.attemptId ?? null)).catch(() => {});
  }, [topicId]);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!d) return <LoadingBlock />;
  async function markDone() {
    if (!task) return;
    setBusy(true);
    try { await api(`/users/me/plan/items/${task}`, { method: 'PATCH', body: { done: true } }); setDone(true); } finally { setBusy(false); }
  }
  return (
    <div className="mx-auto max-w-[720px] space-y-6">
      <PageHeader title={d.topic.name} description={d.topic.subjectName} back={{ href: '/app/roadmap', label: 'Roadmap' }} />
      {d.guide ? (
        <Card>
          <p className="text-body-lg">{d.guide.summary}</p>
          <h2 className="mt-6 text-headline font-semibold">Yang perlu kamu pahami</h2>
          <CheckList className="mt-3" items={d.guide.keyPoints} />
        </Card>
      ) : (
        <Card><p className="text-neutral-600">Panduan untuk topik ini sedang disiapkan. Mulai dari pembahasan soalnya.</p></Card>
      )}
      <div className="flex flex-wrap items-center gap-4">
        {attemptId && <ButtonLink href={`/app/hasil/${attemptId}/pembahasan?topik=${topicId}`} variant="secondary">Ulangi pembahasan soal topik ini</ButtonLink>}
        {task && (done ? <span role="status" className="text-callout text-success-700">✓ Tugas ditandai selesai</span>
          : <Button loading={busy} onClick={markDone}>Tandai tugas selesai</Button>)}
      </div>
    </div>
  );
}

/** STU-18 Panduan Materi (FR-RMP-05, EP-RMP-05). */
export default function GuidePage({ params }: { params: Promise<{ topicId: string }> }) {
  const { topicId } = use(params);
  return <Suspense fallback={<LoadingBlock />}><Guide topicId={topicId} /></Suspense>;
}
