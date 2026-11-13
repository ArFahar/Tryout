'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COGNITIVE_LEVELS, DIFFICULTIES, OPTION_KEYS } from '@cogniverse/contracts';
import { Alert, Button, Card, Dialog, Field, LoadingBlock, PageHeader, Select, Textarea, cx } from './ui';
import { RichContent } from './rich';
import { StatusBadge, DIFFICULTY } from './question-bank';
import { api, ApiError, fmt } from '@/lib/api';
import { htmlToText, textToHtml } from '@/lib/richtext';
import { useSession } from '@/lib/session';

const COGNITIVE: Record<string, string> = { REMEMBER: 'Mengingat', UNDERSTAND: 'Memahami', APPLY: 'Menerapkan', ANALYZE: 'Menganalisis', EVALUATE: 'Mengevaluasi', CREATE: 'Mencipta' };

type Opt = { key: string; text: string; isCorrect: boolean };

/** ADM-04 Question Editor / CTR-02 (wireframe 5.12). Komponen sama untuk kontributor dan editor (UD-09). */
export function QuestionEditor({ questionId, versionId, basePath }: { questionId: string; versionId: string; basePath: string }) {
  const router = useRouter();
  const { me } = useSession();
  const [subjects, setSubjects] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [form, setForm] = useState({ subjectId: '', topicId: '', difficulty: '', cognitiveLevel: '', stem: '', explanation: '' });
  const [opts, setOpts] = useState<Opt[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string; details?: string[] } | null>(null);
  const [retire, setRetire] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      const [v, q] = await Promise.all([api(`/question-versions/${versionId}`), api(`/questions/${questionId}`)]);
      setData(v);
      setHistory(q.versions);
      const x = v.version;
      setForm({ subjectId: x.subjectId ?? '', topicId: x.topicId ?? '', difficulty: x.difficulty ?? '', cognitiveLevel: x.cognitiveLevel ?? '',
        stem: htmlToText(x.stemHtml), explanation: htmlToText(x.explanationHtml) });
      const o: Opt[] = x.options.map((y: any) => ({ key: y.key, text: htmlToText(y.contentHtml), isCorrect: y.isCorrect }));
      setOpts(o.length ? o : OPTION_KEYS.map((k) => ({ key: k, text: '', isCorrect: false })));
      setDirty(false);
    } catch (e) { setMsg({ tone: 'danger', text: (e as ApiError).message }); }
  }, [questionId, versionId]);
  useEffect(() => { load(); api('/subjects').then((r) => setSubjects(r.data)).catch(() => {}); }, [load]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const topics = useMemo(() => subjects.find((s) => s.id === form.subjectId)?.topics ?? [], [subjects, form.subjectId]);
  if (!data) return msg ? <Alert tone="danger">{msg.text}</Alert> : <LoadingBlock />;
  const v = data.version;
  const editable: boolean = data.editable;
  const isEditor = !!me && (me.roles.includes('CONTENT_EDITOR') || me.roles.includes('SUPER_ADMIN'));
  const set = (patch: Partial<typeof form>) => { setForm({ ...form, ...patch }); setDirty(true); };
  const body = () => ({
    subjectId: form.subjectId || null, topicId: form.topicId || null, difficulty: form.difficulty || null, cognitiveLevel: form.cognitiveLevel || null,
    stemHtml: textToHtml(form.stem), explanationHtml: textToHtml(form.explanation),
    options: opts.filter((o, i) => i < 4 || o.text.trim()).map((o) => ({ key: o.key, contentHtml: textToHtml(o.text), isCorrect: o.isCorrect })),
  });

  async function save(silent = false) {
    setBusy('save');
    try {
      await api(`/question-versions/${versionId}`, { method: 'PUT', body: body() });
      setDirty(false);
      if (!silent) setMsg({ tone: 'success', text: 'Draf tersimpan.' });
      return true;
    } catch (e) {
      const ae = e as ApiError;
      setMsg({ tone: 'danger', text: ae.message, details: ae.details?.map((d) => d.message) });
      return false;
    } finally { setBusy(null); }
  }
  async function submit() {
    if (!(await save(true))) return;
    setBusy('submit');
    try {
      await api(`/question-versions/${versionId}/submit`, { method: 'POST' });
      setMsg({ tone: 'success', text: 'Soal diajukan untuk review. Isi soal terkunci selama ditinjau.' });
      await load();
    } catch (e) {
      const ae = e as ApiError;
      setMsg({ tone: 'warning', text: ae.message, details: ae.details?.map((d) => d.message) });
    } finally { setBusy(null); }
  }
  async function act(path: string, label: string, after?: (r: any) => void) {
    setBusy(label);
    try { const r = await api(path, { method: 'POST', body: {} }); after ? after(r) : await load(); }
    catch (e) { setMsg({ tone: 'danger', text: (e as ApiError).message }); }
    finally { setBusy(null); }
  }

  const preview = (
    <Card className="space-y-4">
      <h2 className="text-sm font-medium text-neutral-600">Pratinjau tampilan siswa</h2>
      <RichContent html={textToHtml(form.stem) || '<p><em>Teks soal belum diisi.</em></p>'} className="text-[17px] leading-[1.65]" />
      <ul className="space-y-2">
        {opts.filter((o, i) => i < 4 || o.text.trim()).map((o) => (
          <li key={o.key} className="flex gap-3 rounded-md border border-neutral-200 px-3 py-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-neutral-500 text-xs font-bold">{o.key}</span>
            <RichContent html={textToHtml(o.text) || '<p>—</p>'} className="min-w-0 flex-1" />
          </li>
        ))}
      </ul>
    </Card>
  );

  return (
    <>
      <PageHeader title={`Soal · versi ${v.versionNumber}`} back={{ href: basePath, label: 'Daftar soal' }}
        description={<span className="mt-1 flex flex-wrap items-center gap-2"><StatusBadge status={v.status} />
          {data.questionStatus === 'RETIRED' && <span className="text-sm">· soal di-retire</span>}
          <span className="text-sm">Penulis: {data.isOwn ? 'Saya' : v.authorName}</span></span>}
        actions={<>
          {editable && <Button variant="secondary" loading={busy === 'save'} onClick={() => save()} disabled={!dirty}>Simpan Draf</Button>}
          {editable && (data.isOwn || v.authorId === me?.id) && <Button variant="solid" loading={busy === 'submit'} onClick={submit}>Ajukan Review</Button>}
          {v.status === 'IN_REVIEW' && v.authorId === me?.id && <Button variant="secondary" loading={busy === 'withdraw'} onClick={() => act(`/question-versions/${versionId}/withdraw`, 'withdraw')}>Tarik Pengajuan</Button>}
          {v.status === 'APPROVED' && data.questionStatus === 'ACTIVE' && (data.isOwn || isEditor) &&
            <Button variant="primary" loading={busy === 'new'} onClick={() => act(`/questions/${questionId}/versions`, 'new', (r) => router.push(`${basePath}/${questionId}/versi/${r.version.id}`))}>Buat Versi Baru</Button>}
          {isEditor && data.questionStatus === 'ACTIVE' && <Button variant="ghost" onClick={() => setRetire(true)}>Retire Soal</Button>}
        </>} />

      {msg && (
        <Alert tone={msg.tone} className="mb-4">
          {msg.text}
          {msg.details && <ul className="mt-1 list-disc pl-5">{msg.details.map((d) => <li key={d}>{d}</li>)}</ul>}
        </Alert>
      )}
      {v.status === 'CHANGES_REQUESTED' && data.reviews[0] && (
        <Alert tone="warning" title="Reviewer meminta perbaikan" className="mb-4">{data.reviews[0].notes}</Alert>
      )}
      {!editable && v.status !== 'CHANGES_REQUESTED' && (
        <Alert tone="info" className="mb-4">
          {v.status === 'IN_REVIEW' ? 'Versi ini sedang ditinjau dan tidak dapat diubah.' : v.status === 'APPROVED' ? 'Versi yang disetujui tidak dapat diubah. Buat versi baru untuk melakukan perubahan.' : 'Versi ini tidak dapat diubah.'}
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <Card className="space-y-4">
            <h2 className="text-lg font-medium">Metadata</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Subtes" required>{(p) => (
                <Select {...p} value={form.subjectId} disabled={!editable} onChange={(e) => set({ subjectId: e.target.value, topicId: '' })}>
                  <option value="">Pilih subtes</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>)}</Field>
              <Field label="Topik" required>{(p) => (
                <Select {...p} value={form.topicId} disabled={!editable || !form.subjectId} onChange={(e) => set({ topicId: e.target.value })}>
                  <option value="">Pilih topik</option>{topics.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>)}</Field>
              <Field label="Tingkat kesulitan" required>{(p) => (
                <Select {...p} value={form.difficulty} disabled={!editable} onChange={(e) => set({ difficulty: e.target.value })}>
                  <option value="">Pilih</option>{DIFFICULTIES.map((d) => <option key={d} value={d}>{DIFFICULTY[d]}</option>)}
                </Select>)}</Field>
              <Field label="Level kognitif" required>{(p) => (
                <Select {...p} value={form.cognitiveLevel} disabled={!editable} onChange={(e) => set({ cognitiveLevel: e.target.value })}>
                  <option value="">Pilih</option>{COGNITIVE_LEVELS.map((d) => <option key={d} value={d}>{COGNITIVE[d]}</option>)}
                </Select>)}</Field>
            </div>
          </Card>

          <Card className="space-y-4">
            <h2 className="text-lg font-medium">Soal</h2>
            <p className="text-sm text-neutral-600">Pisahkan paragraf dengan baris kosong. Tulis rumus dengan <code>\(</code> … <code>\)</code>, misalnya <code>\(x^2 + 1\)</code>. Tag <code>&lt;strong&gt;</code>, <code>&lt;em&gt;</code>, dan <code>&lt;blockquote&gt;</code> boleh dipakai.</p>
            <Field label="Teks soal" required>{(p) => <Textarea {...p} rows={6} value={form.stem} disabled={!editable} onChange={(e) => set({ stem: e.target.value })} />}</Field>
            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-medium">Opsi jawaban (4–5) dan kunci <span className="text-danger-700" aria-hidden="true">*</span></legend>
              {opts.map((o, i) => (
                <div key={o.key} className={cx('flex items-start gap-3 rounded-md border p-3', o.isCorrect ? 'border-[1.5px] border-success-700 bg-success-50' : 'border-neutral-200')}>
                  <label className="flex shrink-0 flex-col items-center gap-1 pt-1 text-xs font-medium">
                    <input type="radio" name="kunci" className="h-5 w-5 accent-[var(--color-success-700)]" checked={o.isCorrect} disabled={!editable}
                      aria-label={`Jadikan opsi ${o.key} sebagai kunci`}
                      onChange={() => { setOpts(opts.map((x) => ({ ...x, isCorrect: x.key === o.key }))); setDirty(true); }} />
                    {o.isCorrect ? 'Kunci' : ''}
                  </label>
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`opt-${o.key}`} className="text-sm font-bold">Opsi {o.key}{i === 4 && <span className="font-normal text-neutral-600"> (opsional)</span>}</label>
                    <Textarea id={`opt-${o.key}`} rows={2} className="mt-1 min-h-0" value={o.text} disabled={!editable}
                      onChange={(e) => { setOpts(opts.map((x) => (x.key === o.key ? { ...x, text: e.target.value } : x))); setDirty(true); }} />
                  </div>
                </div>
              ))}
            </fieldset>
            <Field label="Pembahasan" required help="Wajib diisi sebelum diajukan. Ditampilkan ke siswa setelah ujian.">{(p) => <Textarea {...p} rows={5} value={form.explanation} disabled={!editable} onChange={(e) => set({ explanation: e.target.value })} />}</Field>
          </Card>
        </div>

        <aside className="space-y-6 xl:sticky xl:top-24 xl:self-start">
          {preview}
          <Card>
            <h2 className="text-lg font-medium">Riwayat versi</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2">
                  <Link href={`${basePath}/${questionId}/versi/${h.id}`} className={cx('hover:underline', h.id === versionId ? 'font-bold' : 'text-primary-600')}>Versi {h.versionNumber}</Link>
                  <StatusBadge status={h.status} />
                </li>
              ))}
            </ul>
          </Card>
          {data.reviews.length > 0 && (
            <Card>
              <h2 className="text-lg font-medium">Riwayat review</h2>
              <ol className="mt-3 space-y-3 text-sm">
                {data.reviews.map((r: any) => (
                  <li key={r.id} className="border-l-2 border-neutral-200 pl-3">
                    <p className="font-medium"><StatusBadge status={r.decision} /> <span className="ml-1 font-normal text-neutral-600">{r.reviewer} · {fmt.dateTime(r.createdAt)}</span></p>
                    {r.notes && <p className="mt-1 text-neutral-700">{r.notes}</p>}
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </aside>
      </div>

      <Dialog open={retire} title="Retire soal ini?" onClose={() => setRetire(false)}
        footer={<><Button variant="secondary" data-autofocus onClick={() => setRetire(false)}>Batal</Button>
          <Button variant="danger" loading={busy === 'retire'} disabled={reason.trim().length < 10} onClick={async () => {
            setBusy('retire');
            try { await api(`/questions/${questionId}/retire`, { method: 'POST', body: { reason } }); setRetire(false); await load(); }
            catch (e) { setMsg({ tone: 'danger', text: (e as ApiError).message }); } finally { setBusy(null); }
          }}>Retire</Button></>}>
        <p>Soal yang di-retire tidak dapat dipakai di ujian baru. Ujian dan hasil yang sudah ada tidak berubah.</p>
        <Field label="Alasan" required help="Minimal 10 karakter.">{(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </Dialog>
    </>
  );
}
