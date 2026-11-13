'use client';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, CheckList, LoadingBlock, PageHeader, Textarea, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

/** ADM-17 Panduan Materi (FR-RMP-05, EP-RMP-06): ringkasan + maks. 12 poin per topik, teks polos. */
export default function Guides() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [points, setPoints] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const load = () => api('/admin/topic-guides').then((r) => setRows(r.data)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const cur = rows?.find((r) => r.topicId === sel);
  function pick(r: any) {
    setSel(r.topicId); setMsg(null);
    setSummary(r.guide?.summary ?? ''); setPoints((r.guide?.keyPoints ?? []).join('\n'));
  }
  const list = points.split('\n').map((x) => x.trim()).filter(Boolean);
  async function save() {
    setBusy(true); setMsg(null);
    try {
      await api(`/admin/topics/${sel}/guide`, { method: 'PUT', body: { summary, keyPoints: list } });
      setMsg({ tone: 'success', text: 'Panduan tersimpan.' }); load();
    } catch (e) { setMsg({ tone: 'danger', text: (e as ApiError).details?.map((d) => d.message).join(' ') || (e as ApiError).message }); }
    finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader title="Panduan materi" description="Dipakai roadmap siswa: tugas 'Pelajari materi' membuka panduan topik ini." />
      {error && <Alert tone="danger">{error}</Alert>}
      {!rows ? <LoadingBlock /> : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <ul className="space-y-1 rounded-lg bg-white p-2">
            {rows.map((r) => (
              <li key={r.topicId}>
                <button type="button" onClick={() => pick(r)} aria-current={sel === r.topicId ? 'true' : undefined}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-callout ${sel === r.topicId ? 'bg-primary-50 font-semibold text-primary-800' : 'hover:bg-neutral-50'}`}>
                  <span>{r.topicName}<span className="block text-footnote font-normal text-neutral-600">{r.subjectName}</span></span>
                  <Badge tone={r.guide ? 'success' : 'neutral'}>{r.guide ? 'Ada' : 'Belum'}</Badge>
                </button>
              </li>
            ))}
          </ul>
          {cur ? (
            <div className="space-y-4">
              <Card className="space-y-4">
                <h2 className="text-title-3 font-semibold">{cur.topicName}</h2>
                {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
                <Field label="Ringkasan" required help="10–2000 karakter.">{(p) => <Textarea {...p} rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />}</Field>
                <Field label="Poin yang perlu dipahami" help={`Satu poin per baris; maksimal 12 (${list.length}/12).`} error={list.length > 12 ? 'Maksimal 12 poin.' : undefined}>{(p) => <Textarea {...p} rows={6} value={points} onChange={(e) => setPoints(e.target.value)} />}</Field>
                <Button loading={busy} disabled={summary.trim().length < 10 || list.length > 12} onClick={save}>Simpan Panduan</Button>
              </Card>
              <Card variant="muted">
                <p className="text-caption font-semibold uppercase text-neutral-600">Pratinjau tampilan siswa</p>
                <p className="mt-2 text-body-lg">{summary || '—'}</p>
                {list.length > 0 && <CheckList className="mt-3" items={list} />}
              </Card>
            </div>
          ) : <p className="text-neutral-600">Pilih topik di sebelah kiri.</p>}
        </div>
      )}
    </>
  );
}
