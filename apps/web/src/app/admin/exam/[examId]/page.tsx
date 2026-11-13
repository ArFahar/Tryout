'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Field, Input, LoadingBlock, PageHeader, Select, Textarea, cx } from '@/components/ui';
import { DIFFICULTY } from '@/components/question-bank';
import { api, ApiError, fmt } from '@/lib/api';
import { EXAM_STATUS } from '@/lib/labels';
import { htmlToText, textToHtml } from '@/lib/richtext';

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 7 * 3600e3); // WIB
  return d.toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(`${v}:00+07:00`).toISOString() : null);

/** ADM-07 Exam Builder (wireframe 5.14). */
export default function ExamBuilder({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = use(params);
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string; details?: string[] } | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [sections, setSections] = useState<any[]>([]);
  const [picker, setPicker] = useState<string | null>(null);
  const [issues, setIssues] = useState<any[] | null>(null);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [confirmWarn, setConfirmWarn] = useState(false);
  const [series, setSeries] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [unpub, setUnpub] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api(`/admin/exams/${examId}`);
      setD(r);
      setMeta({
        title: r.exam.title, description: r.exam.description, instructions: htmlToText(r.exam.instructionsHtml), durationMinutes: r.exam.durationMinutes ?? '',
        availableFrom: toLocalInput(r.exam.availableFrom), availableUntil: toLocalInput(r.exam.availableUntil), maxAttempts: r.exam.maxAttempts,
        seriesId: r.exam.seriesId ?? '',
      });
      setSections(r.sections.map((s: any) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes ?? '' })));
      const dry = await api(`/admin/exams/${examId}/publish`, { method: 'POST', body: { dryRun: true } });
      setIssues(dry.issues);
      setWarnings(dry.warnings ?? []);
      api('/admin/series').then((x) => setSeries(x.data.filter((y: any) => y.status === 'ACTIVE'))).catch(() => {});
    } catch (e) { setError((e as ApiError).message); }
  }, [examId]);
  useEffect(() => { load(); }, [load]);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!d || !meta) return <LoadingBlock />;
  const e = d.exam;
  const locked = e.structureLocked;
  const published = e.status !== 'DRAFT';
  const total = d.sections.reduce((n: number, s: any) => n + s.questions.length, 0);

  const show = (err: unknown) => {
    const ae = err as ApiError;
    setMsg({ tone: 'danger', text: ae.message, details: ae.details?.map((x) => x.message) });
  };
  async function saveMeta() {
    setBusy('meta'); setMsg(null);
    try {
      const body: any = { title: meta.title, description: meta.description, instructionsHtml: textToHtml(meta.instructions), availableUntil: fromLocalInput(meta.availableUntil) };
      if (!published) Object.assign(body, {
        durationMinutes: e.timingMode === 'TOTAL' && meta.durationMinutes !== '' ? Number(meta.durationMinutes) : null,
        availableFrom: fromLocalInput(meta.availableFrom), maxAttempts: Number(meta.maxAttempts),
      });
      if (e.attemptCount === 0 && (meta.seriesId || null) !== (e.seriesId ?? null)) body.seriesId = meta.seriesId || null;
      await api(`/admin/exams/${examId}`, { method: 'PATCH', body });
      setMsg({ tone: 'success', text: 'Pengaturan tersimpan.' });
      await load();
    } catch (err) { show(err); } finally { setBusy(null); }
  }
  async function saveSections() {
    setBusy('sections'); setMsg(null);
    try {
      await api(`/admin/exams/${examId}/sections`, { method: 'PUT', body: { sections: sections.map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes === '' ? null : Number(s.durationMinutes) })) } });
      setMsg({ tone: 'success', text: 'Susunan subtes tersimpan.' });
      await load();
    } catch (err) { show(err); } finally { setBusy(null); }
  }
  async function setQuestions(sectionId: string, versionIds: string[]) {
    setBusy(`q-${sectionId}`); setMsg(null);
    try {
      await api(`/admin/exams/${examId}/sections/${sectionId}/questions`, { method: 'PUT', body: { items: versionIds.map((id) => ({ questionVersionId: id })) } });
      await load();
    } catch (err) { show(err); } finally { setBusy(null); }
  }
  // FR-EXM-13: peringatan parameter produk perlu dikonfirmasi, bukan menghalangi
  async function publish(confirmWarnings = false) {
    if (warnings.length && !confirmWarnings) { setConfirmWarn(true); return; }
    setBusy('publish'); setMsg(null);
    try {
      await api(`/admin/exams/${examId}/publish`, { method: 'POST', body: { confirmWarnings } });
      setConfirmWarn(false);
      setMsg({ tone: 'success', text: confirmWarnings ? 'Ujian terbit dengan peringatan yang sudah Anda konfirmasi.' : 'Ujian terbit dan tampil di katalog.' });
      await load();
    } catch (err) { show(err); } finally { setBusy(null); }
  }

  const moveSection = (i: number, dir: -1 | 1) => {
    const n = [...sections];
    const j = i + dir;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    setSections(n);
  };

  return (
    <>
      <PageHeader title={e.title} back={{ href: '/admin/exam', label: 'Ujian' }}
        description={<span className="mt-1 flex flex-wrap items-center gap-2 text-sm"><Badge tone={EXAM_STATUS[e.status][1]}>{EXAM_STATUS[e.status][0]}</Badge>
          Full Try Out{e.seriesId && series.length > 0 ? ` · musim ${series.find((x) => x.id === e.seriesId)?.name ?? ''}` : ' · belum masuk musim'} · {e.timingMode === 'PER_SECTION' ? 'timer per subtes' : 'timer total'} · {total} soal · {e.entitlementCount} peserta</span>}
        actions={e.status === 'PUBLISHED'
          ? <Button variant="secondary" onClick={() => setUnpub(true)}>Tarik dari Katalog</Button>
          : <Button loading={busy === 'publish'} disabled={!!issues?.length} onClick={() => publish()}>Publikasikan</Button>} />

      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}{msg.details && <ul className="mt-1 list-disc pl-5">{msg.details.map((x) => <li key={x}>{x}</li>)}</ul>}</Alert>}
      {locked && <Alert tone="info" className="mb-4">Struktur ujian (subtes dan soal) terkunci karena ujian sudah dipublikasikan atau sudah ada peserta.</Alert>}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card className="space-y-4">
            <h2 className="text-lg font-medium">Pengaturan</h2>
            <Field label="Judul" required>{(p) => <Input {...p} value={meta.title} onChange={(x) => setMeta({ ...meta, title: x.target.value })} />}</Field>
            <Field label="Deskripsi">{(p) => <Textarea {...p} value={meta.description} onChange={(x) => setMeta({ ...meta, description: x.target.value })} />}</Field>
            <Field label="Instruksi tambahan" help="Ditampilkan di halaman instruksi sebelum siswa mulai.">{(p) => <Textarea {...p} rows={4} value={meta.instructions} onChange={(x) => setMeta({ ...meta, instructions: x.target.value })} />}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {e.timingMode === 'TOTAL' && <Field label="Durasi total (menit)" required>{(p) => <Input {...p} type="number" min={1} disabled={published} value={meta.durationMinutes} onChange={(x) => setMeta({ ...meta, durationMinutes: x.target.value })} />}</Field>}
              <Field label="Kesempatan mengerjakan" help="1–5 kali.">{(p) => (
                <Select {...p} disabled={published} value={meta.maxAttempts} onChange={(x) => setMeta({ ...meta, maxAttempts: x.target.value })}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}×</option>)}
                </Select>)}</Field>
              {<Field label="Musim" help={e.attemptCount > 0 ? 'Terkunci karena sudah ada pengerjaan siswa.' : 'Wajib sebelum terbit. Periode dalam satu musim dapat dibandingkan di Progres siswa.'}>{(p) => (
                <Select {...p} disabled={e.attemptCount > 0} value={meta.seriesId} onChange={(x) => setMeta({ ...meta, seriesId: x.target.value })}>
                  <option value="">Belum dipilih</option>
                  {series.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
                </Select>)}</Field>}
              <Field label="Tersedia mulai (WIB)" required>{(p) => <Input {...p} type="datetime-local" disabled={published} value={meta.availableFrom} onChange={(x) => setMeta({ ...meta, availableFrom: x.target.value })} />}</Field>
              <Field label="Tersedia sampai (WIB)" required help={published ? 'Setelah terbit hanya dapat diperpanjang.' : undefined}>{(p) => <Input {...p} type="datetime-local" value={meta.availableUntil} onChange={(x) => setMeta({ ...meta, availableUntil: x.target.value })} />}</Field>
            </div>
            <Button variant="secondary" loading={busy === 'meta'} onClick={saveMeta}>Simpan Pengaturan</Button>
          </Card>

          <Card className="space-y-4">
            <div className="flex items-center justify-between"><h2 className="text-lg font-medium">Subtes</h2><span className="text-sm text-neutral-600">Akses lewat paket musim</span></div>
            <ol className="space-y-2">
              {sections.map((s, i) => (
                <li key={s.id ?? `new-${i}`} className="flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 p-3">
                  <span className="w-6 pb-3 text-sm font-bold tabular">{i + 1}.</span>
                  <div className="min-w-48 flex-1"><Field label="Nama subtes">{(p) => <Input {...p} disabled={locked} value={s.name} onChange={(x) => setSections(sections.map((y, j) => (j === i ? { ...y, name: x.target.value } : y)))} />}</Field></div>
                  {e.timingMode === 'PER_SECTION' && <div className="w-32"><Field label="Durasi (menit)">{(p) => <Input {...p} type="number" min={1} disabled={locked} value={s.durationMinutes} onChange={(x) => setSections(sections.map((y, j) => (j === i ? { ...y, durationMinutes: x.target.value } : y)))} />}</Field></div>}
                  {!locked && <div className="flex gap-1 pb-1">
                    <Button size="sm" variant="ghost" aria-label={`Naikkan subtes ${i + 1}`} disabled={i === 0} onClick={() => moveSection(i, -1)}>↑</Button>
                    <Button size="sm" variant="ghost" aria-label={`Turunkan subtes ${i + 1}`} disabled={i === sections.length - 1} onClick={() => moveSection(i, 1)}>↓</Button>
                    <Button size="sm" variant="ghost" aria-label={`Hapus subtes ${i + 1}`} disabled={sections.length === 1} onClick={() => setSections(sections.filter((_, j) => j !== i))}>Hapus</Button>
                  </div>}
                </li>
              ))}
            </ol>
            {!locked && <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setSections([...sections, { name: `Subtes ${sections.length + 1}`, durationMinutes: '' }])}>Tambah Subtes</Button>
              <Button variant="primary" loading={busy === 'sections'} onClick={saveSections}>Simpan Susunan Subtes</Button>
            </div>}
          </Card>

          {d.sections.map((s: any) => (
            <Card key={s.id} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-medium">{s.position}. {s.name} <span className="text-sm font-normal text-neutral-600">· {s.questions.length} soal</span></h2>
                {!locked && <Button size="sm" variant="primary" onClick={() => setPicker(s.id)}>Tambah Soal</Button>}
              </div>
              {s.questions.length === 0 ? <p className="text-sm text-neutral-600">Belum ada soal.</p> : (
                <ol className="divide-y divide-neutral-100">
                  {s.questions.map((q: any, i: number) => {
                    const ids = s.questions.map((x: any) => x.questionVersionId);
                    const swap = (j: number) => { const n = [...ids]; [n[i], n[j]] = [n[j], n[i]]; setQuestions(s.id, n); };
                    return (
                      <li key={q.examQuestionId} className="flex items-start gap-3 py-2.5">
                        <span className="w-6 text-sm font-bold tabular">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm">{q.stemPlain}</p>
                          <p className="text-xs text-neutral-600">{q.topicName} · {DIFFICULTY[q.difficulty]} · v{q.versionNumber}
                            {q.isStale && <span className="ml-2 text-warning-700">· ada versi lebih baru</span>}
                            {q.questionStatus !== 'ACTIVE' && <span className="ml-2 text-danger-700">· di-retire</span>}</p>
                        </div>
                        {!locked && <div className="flex shrink-0 gap-1">
                          <Button size="sm" variant="ghost" aria-label="Naikkan" disabled={i === 0 || !!busy} onClick={() => swap(i - 1)}>↑</Button>
                          <Button size="sm" variant="ghost" aria-label="Turunkan" disabled={i === ids.length - 1 || !!busy} onClick={() => swap(i + 1)}>↓</Button>
                          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setQuestions(s.id, ids.filter((x: string) => x !== q.questionVersionId))}>Hapus</Button>
                        </div>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </Card>
          ))}
        </div>

        <aside className="xl:sticky xl:top-24 xl:self-start">
          <Card>
            <h2 className="text-lg font-medium">Pemeriksaan publikasi</h2>
            {e.status === 'PUBLISHED' ? <p className="mt-2 text-sm text-success-700">✓ Ujian terbit sejak {fmt.dateTime(e.publishedAt)}.</p>
              : !issues ? <p className="mt-2 text-sm">Memeriksa…</p>
                : issues.length === 0 ? <p className="mt-2 text-sm text-success-700">✓ Semua syarat terpenuhi. Ujian siap dipublikasikan.</p>
                  : <ul className="mt-2 space-y-1.5 text-sm">{issues.map((x: any, i: number) => <li key={i} className="flex gap-2 text-danger-700"><span aria-hidden="true">○</span>{x.message}</li>)}</ul>}
            {e.status !== 'PUBLISHED' && warnings.length > 0 && (
              <div className="mt-4 border-t border-neutral-200 pt-4">
                <p className="text-callout font-semibold">Peringatan parameter produk</p>
                <ul className="mt-2 space-y-1.5 text-sm">{warnings.map((x: any, i: number) => <li key={i} className="flex gap-2 text-warning-700"><span aria-hidden="true">!</span>{x.message}</li>)}</ul>
                <p className="mt-2 text-footnote text-neutral-600">Peringatan tidak menghalangi publikasi, tetapi perlu Anda konfirmasi.</p>
              </div>
            )}
          </Card>
        </aside>
      </div>

      {picker && <QuestionPicker sectionId={picker} examQuestionIds={d.sections.flatMap((s: any) => s.questions.map((q: any) => q.questionId))}
        onClose={() => setPicker(null)}
        onAdd={async (versionIds) => {
          const sec = d.sections.find((s: any) => s.id === picker);
          await setQuestions(picker, [...sec.questions.map((q: any) => q.questionVersionId), ...versionIds]);
          setPicker(null);
        }} />}

      <Dialog open={confirmWarn} title="Terbitkan dengan peringatan?" onClose={() => setConfirmWarn(false)}
        footer={<><Button variant="secondary" data-autofocus onClick={() => setConfirmWarn(false)}>Periksa Lagi</Button>
          <Button loading={busy === 'publish'} onClick={() => publish(true)}>Ya, Terbitkan</Button></>}>
        <ul className="list-disc space-y-1 pl-5">{warnings.map((x: any, i: number) => <li key={i}>{x.message}</li>)}</ul>
        <p className="mt-3 text-callout text-neutral-600">Konfirmasi Anda tercatat di audit log.</p>
      </Dialog>

      <Dialog open={unpub} title="Tarik ujian dari katalog?" onClose={() => setUnpub(false)}
        footer={<><Button variant="secondary" data-autofocus onClick={() => setUnpub(false)}>Batal</Button>
          <Button variant="danger" disabled={reason.trim().length < 10} loading={busy === 'unpub'} onClick={async () => {
            setBusy('unpub');
            try { await api(`/admin/exams/${examId}/unpublish`, { method: 'POST', body: { reason } }); setUnpub(false); await load(); }
            catch (err) { show(err); } finally { setBusy(null); }
          }}>Tarik</Button></>}>
        <p>Siswa baru tidak dapat mengklaim ujian ini. Siswa yang sudah memiliki akses tetap dapat mengerjakannya sampai masa berlakunya habis.</p>
        <Field label="Alasan" required help="Minimal 10 karakter; tercatat di audit log.">{(p) => <Textarea {...p} value={reason} onChange={(x) => setReason(x.target.value)} />}</Field>
      </Dialog>
    </>
  );
}

function QuestionPicker({ examQuestionIds, onClose, onAdd }: { sectionId: string; examQuestionIds: string[]; onClose: () => void; onAdd: (versionIds: string[]) => Promise<void> }) {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/subjects').then((r) => setSubjects(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    const p = new URLSearchParams({ approvedOnly: 'true', pageSize: '50' });
    if (subjectId) p.set('subjectId', subjectId);
    if (q) p.set('q', q);
    const t = setTimeout(() => api(`/questions?${p}`).then((r) => setRows(r.data)).catch(() => setRows([])), 250);
    return () => clearTimeout(t);
  }, [subjectId, q]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/50 sm:items-center sm:p-4" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Pilih soal" className="flex max-h-[90vh] w-full max-w-[800px] flex-col rounded-t-lg bg-white shadow-lg sm:rounded-lg">
        <div className="border-b border-neutral-200 p-4">
          <h2 className="text-xl font-bold">Pilih soal yang disetujui</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_220px]">
            <Input aria-label="Cari teks soal" placeholder="Cari teks soal" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <Select aria-label="Subtes" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Semua subtes</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
        </div>
        <ul className="flex-1 divide-y divide-neutral-100 overflow-y-auto p-2">
          {!rows ? <li className="p-4 text-sm">Memuat…</li> : rows.length === 0 ? <li className="p-4 text-sm text-neutral-600">Tidak ada soal yang cocok.</li> : rows.map((r) => {
            const used = examQuestionIds.includes(r.id);
            const vid = r.approvedVersion.id;
            return (
              <li key={r.id}>
                <label className={cx('flex cursor-pointer gap-3 rounded-md p-3', used ? 'opacity-60' : 'hover:bg-neutral-50')}>
                  <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--color-primary-600)]" disabled={used} checked={picked.includes(vid)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, vid] : picked.filter((x) => x !== vid))} />
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-sm">{r.approvedVersion.stemPlain}</span>
                    <span className="text-xs text-neutral-600">{r.subjectCode} · {r.topicName} · {DIFFICULTY[r.approvedVersion.difficulty]}{used && ' · sudah dipakai di ujian ini'}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end gap-2 border-t border-neutral-200 p-4">
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button variant="solid" disabled={!picked.length} loading={busy} onClick={async () => { setBusy(true); await onAdd(picked); setBusy(false); }}>Tambahkan {picked.length || ''} Soal</Button>
        </div>
      </div>
    </div>
  );
}
