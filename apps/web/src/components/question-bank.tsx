'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, EmptyState, LoadingBlock, PageHeader, Select, cx } from './ui';
import { api, fmt } from '@/lib/api';
import { useSession } from '@/lib/session';

export const VERSION_STATUS: Record<string, [string, any]> = {
  DRAFT: ['Draf', 'neutral'], IN_REVIEW: ['Sedang ditinjau', 'info'], CHANGES_REQUESTED: ['Perlu revisi', 'warning'],
  APPROVED: ['Disetujui', 'success'], REJECTED: ['Ditolak', 'danger'],
};
export const DIFFICULTY: Record<string, string> = { EASY: 'Mudah', MEDIUM: 'Sedang', HARD: 'Sulit' };

/** ADM-03 Question Bank / CTR-01 My Questions (server membatasi kontributor pada soal miliknya). */
export function QuestionBank({ basePath, title }: { basePath: string; title: string }) {
  const { me } = useSession();
  const router = useRouter();
  const [subjects, setSubjects] = useState<any[]>([]);
  const [filters, setFilters] = useState({ q: '', subjectId: '', versionStatus: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const canCreate = !!me && (me.roles.includes('CONTENT_EDITOR') || me.roles.includes('CONTRIBUTOR') || me.roles.includes('SUPER_ADMIN'));
  const examAdminOnly = !!me && me.roles.includes('EXAM_ADMIN') && !me.roles.includes('CONTENT_EDITOR') && !me.roles.includes('SUPER_ADMIN');

  useEffect(() => { api('/subjects').then((r) => setSubjects(r.data)).catch(() => {}); }, []);
  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: '20' });
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    setError('');
    api(`/questions?${p}`).then(setData).catch((e) => setError(e.message));
  }, [filters, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function create() {
    setCreating(true);
    try {
      const r = await api('/questions', { method: 'POST', body: { stemHtml: '', explanationHtml: '', options: [] } });
      router.push(`${basePath}/${r.question.id}/versi/${r.version.id}`);
    } catch (e: any) { setError(e.message); setCreating(false); }
  }

  return (
    <>
      <PageHeader title={title} description={examAdminOnly ? 'Hanya soal yang sudah disetujui yang ditampilkan.' : undefined}
        actions={canCreate && <Button variant="solid" loading={creating} onClick={create}>Buat Soal</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px_200px]">
        <label className="relative">
          <span className="sr-only">Cari teks soal</span>
          <input type="search" placeholder="Cari teks soal" value={filters.q} onChange={(e) => { setPage(1); setFilters({ ...filters, q: e.target.value }); }}
            className="h-12 w-full rounded-full border border-neutral-500 bg-white px-5 placeholder:text-neutral-500" />
        </label>
        <Select aria-label="Subtes" value={filters.subjectId} onChange={(e) => { setPage(1); setFilters({ ...filters, subjectId: e.target.value }); }}>
          <option value="">Semua subtes</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        {!examAdminOnly && (
          <Select aria-label="Status versi terakhir" value={filters.versionStatus} onChange={(e) => { setPage(1); setFilters({ ...filters, versionStatus: e.target.value }); }}>
            <option value="">Semua status</option>
            {Object.entries(VERSION_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        )}
      </div>
      {error && <Alert tone="danger" className="mb-4" action={<Button size="sm" variant="secondary" onClick={load}>Coba Lagi</Button>}>{error}</Alert>}
      {!data ? <LoadingBlock /> : data.data.length === 0 ? (
        <EmptyState title="Belum ada soal" action={canCreate && <Button onClick={create}>Buat Soal</Button>}>Soal yang cocok dengan filter akan muncul di sini.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="sticky top-0 border-b border-neutral-200 bg-white text-neutral-600">
              <tr>
                <th className="px-4 py-3 font-medium">Soal</th>
                <th className="px-4 py-3 font-medium">Subtes · Topik</th>
                <th className="px-4 py-3 font-medium">Versi</th>
                <th className="px-4 py-3 font-medium">Penulis</th>
                <th className="px-4 py-3 font-medium">Diperbarui</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((q: any) => {
                const v = q.latestVersion ?? q.approvedVersion;
                const status = q.latestVersion?.status ?? 'APPROVED';
                return (
                  <tr key={q.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                    <td className="max-w-md px-4 py-3">
                      <Link href={`${basePath}/${q.id}/versi/${v.id}`} className="line-clamp-2 font-medium text-neutral-800 hover:text-primary-700 hover:underline">
                        {v.stemPlain || <span className="italic text-neutral-600">(teks soal belum diisi)</span>}
                      </Link>
                      {q.status === 'RETIRED' && <Badge tone="neutral" className="mt-1">Di-retire</Badge>}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{q.subjectCode ?? '—'}{q.topicName && ` · ${q.topicName}`}</td>
                    <td className="px-4 py-3"><div className="flex flex-col items-start gap-1">
                      <Badge tone={VERSION_STATUS[status][1]}>v{v.versionNumber} · {VERSION_STATUS[status][0]}</Badge>
                      {q.latestVersion && q.approvedVersion && q.latestVersion.id !== q.approvedVersion.id && <span className="text-xs text-neutral-600">v{q.approvedVersion.versionNumber} disetujui</span>}
                    </div></td>
                    <td className="px-4 py-3 text-neutral-700">{q.isOwn ? 'Saya' : q.authorName}</td>
                    <td className="px-4 py-3 text-neutral-600">{q.latestVersion ? fmt.dateTime(q.latestVersion.updatedAt) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && data.meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-neutral-600">{(page - 1) * 20 + 1}–{Math.min(page * 20, data.meta.totalItems)} dari {data.meta.totalItems}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Sebelumnya</Button>
            <Button size="sm" variant="secondary" disabled={page >= data.meta.totalPages} onClick={() => setPage(page + 1)}>Berikutnya</Button>
          </div>
        </div>
      )}
    </>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const [l, t] = VERSION_STATUS[status] ?? [status, 'neutral'];
  return <Badge tone={t}>{l}</Badge>;
}
export { cx };
