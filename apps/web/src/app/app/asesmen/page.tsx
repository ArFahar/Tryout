'use client';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, ButtonLink, EmptyState, LoadingBlock, PageHeader, Segmented } from '@/components/ui';
import { ExamTypeBadge } from '@/components/exam-card';
import { api, fmt } from '@/lib/api';
import { STATE_LABEL } from '@/lib/labels';

const TONE: Record<string, any> = { READY: 'info', IN_PROGRESS: 'primary', COMPLETED: 'success', EXPIRED: 'neutral', REVOKED: 'neutral' };
type Tab = 'ACTIVE' | 'DONE' | 'EXPIRED';
const inTab = (state: string, t: Tab) =>
  t === 'ACTIVE' ? ['READY', 'IN_PROGRESS'].includes(state) : t === 'DONE' ? state === 'COMPLETED' : ['EXPIRED', 'REVOKED'].includes(state);

/** STU-03 Asesmen Saya (sebelumnya "Ujian Saya"; /app/ujian-saya dialihkan ke sini). */
export default function Assessments() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('ACTIVE');
  const load = () => { setError(''); api('/users/me/entitlements').then((r) => setRows(r.data)).catch((e) => setError(e.message)); };
  useEffect(load, []);
  const shown = (rows ?? []).filter((e) => inTab(e.state, tab));
  const count = (t: Tab) => (rows ?? []).filter((e) => inTab(e.state, t)).length;
  return (
    <>
      <PageHeader title="Asesmen saya" description="Semua try out yang sudah kamu klaim atau beli." />
      {error ? <Alert tone="danger" action={<Button size="sm" variant="secondary" onClick={load}>Coba Lagi</Button>}>{error}</Alert>
        : !rows ? <LoadingBlock />
          : rows.length === 0 ? <EmptyState title="Belum ada asesmen" action={<ButtonLink href="/app/tryout">Lihat try out</ButtonLink>}>Try out yang kamu klaim akan muncul di sini.</EmptyState>
            : (
              <>
                <Segmented className="mb-6" label="Status asesmen" value={tab} onChange={setTab}
                  options={[{ value: 'ACTIVE', label: 'Aktif', count: count('ACTIVE') }, { value: 'DONE', label: 'Selesai', count: count('DONE') }, { value: 'EXPIRED', label: 'Kedaluwarsa', count: count('EXPIRED') }]} />
                {shown.length === 0 ? <EmptyState title="Tidak ada asesmen di sini" /> : (
                  <ul className="space-y-3">
                    {shown.map((e) => (
                      <li key={e.id} className="flex flex-col gap-4 rounded-lg bg-white p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-2"><ExamTypeBadge type={e.exam.examType} /><Badge tone={TONE[e.state]}>{STATE_LABEL[e.state]}</Badge></div>
                          <h2 className="mt-3 text-title-3 font-semibold">{e.exam.title}</h2>
                          <p className="mt-1 text-callout text-neutral-600">
                            Sisa kesempatan {e.attemptsRemaining} dari {e.maxAttempts} · berlaku sampai {fmt.dateTime(e.validUntil)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-3">
                          {e.state === 'IN_PROGRESS' && <ButtonLink href={`/app/ujian/${e.exam.id}/instruksi`}>Lanjutkan</ButtonLink>}
                          {e.state === 'READY' && <ButtonLink href={`/app/ujian/${e.exam.id}/instruksi`}>Buka Instruksi</ButtonLink>}
                          {e.lastAttemptId && (e.state === 'COMPLETED'
                            ? <ButtonLink href={`/app/hasil/${e.lastAttemptId}`}>Lihat Hasil</ButtonLink>
                            : <ButtonLink href={`/app/hasil/${e.lastAttemptId}`} variant="link">Hasil terakhir</ButtonLink>)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
    </>
  );
}
