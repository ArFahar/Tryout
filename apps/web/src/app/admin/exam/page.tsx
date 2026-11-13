'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Dialog, EmptyState, Field, Input, LoadingBlock, PageHeader, Select, Textarea } from '@/components/ui';
import { api, ApiError, fmt } from '@/lib/api';
import { EXAM_STATUS } from '@/lib/labels';


/** ADM-06 Exam Management */
export default function ExamList() {
  const router = useRouter();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', description: '', timingMode: 'PER_SECTION', seriesId: '' });
  const [series, setSeries] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  useEffect(() => {
    api('/admin/exams').then((r) => setRows(r.data)).catch((e) => setError(e.message));
    api('/admin/series').then((r) => setSeries(r.data.filter((x: any) => x.status === 'ACTIVE'))).catch(() => {});
  }, []);
  async function create() {
    setBusy(true); setFormErr('');
    try {
      const { seriesId, ...rest } = f;
      const r = await api('/admin/exams', { method: 'POST', body: { ...rest, deliveryMode: 'ON_DEMAND', ...(seriesId ? { seriesId } : {}) } });
      router.push(`/admin/exam/${r.exam.id}`);
    } catch (e) { setFormErr((e as ApiError).details?.map((d) => d.message).join(' ') || (e as ApiError).message); setBusy(false); }
  }
  return (
    <>
      <PageHeader title="Ujian" actions={<Button onClick={() => setOpen(true)}>Buat Ujian</Button>} />
      <Alert tone="info" className="mb-4">Setiap ujian adalah satu periode Full Try Out dalam sebuah musim. Akses siswa diatur lewat paket (menu Paket).</Alert>
      {error && <Alert tone="danger">{error}</Alert>}
      {!rows ? <LoadingBlock /> : rows.length === 0 ? <EmptyState title="Belum ada ujian" /> : (
        <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-neutral-200 text-neutral-600">
              <tr><th className="px-4 py-3 font-medium">Ujian</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Soal</th><th className="px-4 py-3 text-right font-medium">Peserta</th><th className="px-4 py-3 text-right font-medium">Pengerjaan</th><th className="px-4 py-3 font-medium">Tersedia sampai</th></tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/exam/${e.id}`} className="font-medium text-neutral-800 hover:text-primary-700 hover:underline">{e.title}</Link>
                    <div className="mt-1 flex flex-wrap gap-2"><Badge tone="neutral">Full Try Out</Badge><Badge>{e.timingMode === 'PER_SECTION' ? 'Timer per subtes' : 'Timer total'}</Badge>{e.seriesName ? <Badge tone="info">Musim: {e.seriesName}</Badge> : <Badge tone="warning">Belum masuk musim</Badge>}</div>
                  </td>
                  <td className="px-4 py-3"><Badge tone={EXAM_STATUS[e.status][1]}>{EXAM_STATUS[e.status][0]}</Badge></td>
                  <td className="px-4 py-3 text-right tabular">{e.questionCount}</td>
                  <td className="px-4 py-3 text-right tabular">{e.entitlementCount}</td>
                  <td className="px-4 py-3 text-right tabular">{e.attemptCount}</td>
                  <td className="px-4 py-3 text-neutral-600">{fmt.dateTime(e.availableUntil)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open} title="Buat ujian" onClose={() => setOpen(false)}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Batal</Button><Button loading={busy} disabled={f.title.trim().length < 3} onClick={create}>Buat</Button></>}>
        <div className="space-y-4">
          {formErr && <Alert tone="danger">{formErr}</Alert>}
          <Field label="Judul" required>{(p) => <Input {...p} data-autofocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <Field label="Deskripsi">{(p) => <Textarea {...p} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
          <Field label="Musim" help="Wajib sebelum terbit; periode hanya dapat diakses lewat paket musimnya.">{(p) => (
            <Select {...p} value={f.seriesId} onChange={(e) => setF({ ...f, seriesId: e.target.value })}>
              <option value="">Pilih nanti</option>
              {series.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
            </Select>)}</Field>
          <Field label="Mode timer" required help="Tidak dapat diubah setelah ujian terbit (BR-DUR-01).">{(p) => (
            <Select {...p} value={f.timingMode} onChange={(e) => setF({ ...f, timingMode: e.target.value })}>
              <option value="PER_SECTION">Per subtes</option><option value="TOTAL">Total</option>
            </Select>)}</Field>
        </div>
      </Dialog>
    </>
  );
}
