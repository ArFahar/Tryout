'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, Field, LoadingBlock, PageHeader, Textarea, cx } from '@/components/ui';
import { RichContent } from '@/components/rich';
import { DIFFICULTY, StatusBadge } from '@/components/question-bank';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

/** ADM-05 Question Review — keputusan (wireframe 5.13; EP-REV-04). Tampilan siswa dulu, kunci setelah ditampilkan (UD-10). */
export default function ReviewDecision({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params);
  const router = useRouter();
  const { me } = useSession();
  const [data, setData] = useState<any>(null);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [decision, setDecision] = useState<'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED' | ''>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api(`/question-versions/${versionId}`).then(setData).catch((e) => setError(e.message));
    api('/subjects').then((r) => setSubjects(r.data)).catch(() => {});
  }, [versionId]);
  if (error && !data) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <LoadingBlock />;
  const v = data.version;
  const subject = subjects.find((s) => s.id === v.subjectId);
  const topic = subject?.topics.find((t: any) => t.id === v.topicId);
  const own = v.authorId === me?.id;

  async function decide() {
    setBusy(true);
    setError('');
    try {
      await api(`/question-versions/${versionId}/reviews`, { method: 'POST', body: { decision, notes: notes || undefined, expectedStatus: 'IN_REVIEW' } });
      router.push('/admin/review');
    } catch (e) {
      const ae = e as ApiError;
      setError(ae.details?.map((d) => d.message).join(' ') || ae.message);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Tinjau soal" back={{ href: '/admin/review', label: 'Antrean review' }}
        description={<span className="mt-1 flex flex-wrap items-center gap-2 text-sm"><StatusBadge status={v.status} />{subject?.name} · {topic?.name} · {DIFFICULTY[v.difficulty]} · versi {v.versionNumber} · {v.authorName}</span>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <Card className="space-y-4">
          <h2 className="text-sm font-medium text-neutral-600">Tampilan siswa</h2>
          <RichContent html={v.stemHtml} className="max-w-[72ch] text-[17px] leading-[1.65]" />
          <ul className="space-y-2">
            {v.options.map((o: any) => (
              <li key={o.key} className={cx('flex gap-3 rounded-md px-4 py-3', showKey && o.isCorrect ? 'border-2 border-success-700 bg-success-50' : 'border border-neutral-200')}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neutral-500 text-sm font-bold">{o.key}</span>
                <RichContent html={o.contentHtml} className="min-w-0 flex-1 pt-0.5" />
                {showKey && o.isCorrect && <span className="text-sm font-medium text-success-800">✓ Kunci</span>}
              </li>
            ))}
          </ul>
          {!showKey ? <Button variant="secondary" onClick={() => setShowKey(true)}>Tampilkan Kunci dan Pembahasan</Button> : (
            <div className="rounded-md bg-neutral-50 p-4">
              <p className="text-sm font-medium">Pembahasan</p>
              <RichContent html={v.explanationHtml} className="mt-1" />
            </div>
          )}
        </Card>
        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          {v.status !== 'IN_REVIEW' ? <Alert tone="info">Versi ini tidak sedang ditinjau.</Alert> : own ? (
            <Alert tone="warning" title="Ini soal Anda">Keputusan review harus diambil Content Editor lain (pemisahan tugas).</Alert>
          ) : (
            <Card className="space-y-4">
              <h2 className="text-lg font-medium">Keputusan</h2>
              <fieldset className="space-y-2">
                <legend className="sr-only">Pilih keputusan</legend>
                {([['APPROVED', 'Setujui'], ['CHANGES_REQUESTED', 'Minta revisi'], ['REJECTED', 'Tolak']] as const).map(([k, l]) => (
                  <label key={k} className={cx('flex h-12 cursor-pointer items-center gap-3 rounded-md border px-4', decision === k ? 'border-[1.5px] border-primary-600 bg-primary-50' : 'border-neutral-500')}>
                    <input type="radio" name="decision" checked={decision === k} onChange={() => setDecision(k)} className="h-5 w-5 accent-[var(--color-primary-600)]" />{l}
                  </label>
                ))}
              </fieldset>
              <Field label="Catatan untuk penulis" required={decision !== 'APPROVED' && decision !== ''} help="Wajib untuk minta revisi dan tolak.">
                {(p) => <Textarea {...p} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />}
              </Field>
              {error && <Alert tone="danger">{error}</Alert>}
              <Button variant="solid" className="w-full" disabled={!decision} loading={busy} onClick={decide}>Kirim Keputusan</Button>
            </Card>
          )}
          {data.reviews.length > 0 && (
            <Card>
              <h2 className="text-sm font-medium">Riwayat review versi ini</h2>
              <ul className="mt-2 space-y-2 text-sm">{data.reviews.map((r: any) => <li key={r.id}><StatusBadge status={r.decision} /> {r.reviewer}: {r.notes}</li>)}</ul>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
