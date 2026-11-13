'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Dialog, EmptyState, Field, Input, LoadingBlock, PageHeader } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

/** ADM-16 Data Kampus & Jurusan (FR-TGT-03): skor acuan wajib bersumber dan bertahun (BR-TGT-02). */
export default function Campuses() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [newUni, setNewUni] = useState(false);
  const [uni, setUni] = useState({ name: '', shortName: '', province: '' });
  const [prog, setProg] = useState<{ universityId: string; name: string } | null>(null);
  const [ref, setRef] = useState<{ id: string; name: string; score: string; source: string; year: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const load = () => { setError(''); api('/admin/universities').then((r) => setRows(r.data)).catch((e) => setError(e.message)); };
  useEffect(load, []);
  async function run(fn: () => Promise<any>, close: () => void) {
    setBusy(true); setFormErr('');
    try { await fn(); close(); load(); }
    catch (e) { setFormErr((e as ApiError).details?.map((d) => d.message).join(' ') || (e as ApiError).message); }
    finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader title="Data kampus & jurusan" description="Skor acuan hanya disimpan bersama sumber dan tahunnya. Tanpa sumber, siswa melihat 'Data acuan belum tersedia'."
        actions={<Button onClick={() => setNewUni(true)}>Tambah Kampus</Button>} />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {!rows ? <LoadingBlock /> : rows.length === 0 ? <EmptyState title="Belum ada kampus" /> : (
        <div className="space-y-4">
          {rows.map((u) => (
            <Card key={u.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-headline font-semibold">{u.name}{u.shortName && <span className="font-normal text-neutral-600"> · {u.shortName}</span>}</h2>
                <Button size="sm" variant="plain" onClick={() => setProg({ universityId: u.id, name: '' })}>Tambah jurusan</Button>
              </div>
              <ul className="mt-3 divide-y divide-neutral-100 text-callout">
                {u.programs.map((p: any) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span>{p.name} <span className="text-footnote text-neutral-600">· {p.targetCount} siswa menargetkan</span></span>
                    <span className="flex items-center gap-2 text-footnote text-neutral-600">
                      {p.reference ? `Acuan ${p.reference.score} · ${p.reference.source}, ${p.reference.year}` : 'Belum ada acuan'}
                      <Button size="sm" variant="plain" onClick={() => setRef({ id: p.id, name: p.name, score: String(p.reference?.score ?? ''), source: p.reference?.source ?? '', year: String(p.reference?.year ?? '') })}>Ubah acuan</Button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={newUni} title="Tambah kampus" onClose={() => setNewUni(false)}
        footer={<><Button variant="secondary" onClick={() => setNewUni(false)}>Batal</Button><Button loading={busy} disabled={uni.name.trim().length < 3}
          onClick={() => run(() => api('/admin/universities', { method: 'POST', body: { name: uni.name, shortName: uni.shortName || undefined, province: uni.province || undefined } }), () => { setNewUni(false); setUni({ name: '', shortName: '', province: '' }); })}>Simpan</Button></>}>
        <div className="space-y-4">
          {formErr && <Alert tone="danger">{formErr}</Alert>}
          <Field label="Nama kampus" required>{(p) => <Input {...p} value={uni.name} onChange={(e) => setUni({ ...uni, name: e.target.value })} />}</Field>
          <Field label="Singkatan">{(p) => <Input {...p} value={uni.shortName} onChange={(e) => setUni({ ...uni, shortName: e.target.value })} />}</Field>
          <Field label="Provinsi">{(p) => <Input {...p} value={uni.province} onChange={(e) => setUni({ ...uni, province: e.target.value })} />}</Field>
        </div>
      </Dialog>
      <Dialog open={!!prog} title="Tambah jurusan" onClose={() => setProg(null)}
        footer={<><Button variant="secondary" onClick={() => setProg(null)}>Batal</Button><Button loading={busy} disabled={!prog || prog.name.trim().length < 2}
          onClick={() => prog && run(() => api('/admin/study-programs', { method: 'POST', body: { universityId: prog.universityId, name: prog.name } }), () => setProg(null))}>Simpan</Button></>}>
        {formErr && <Alert tone="danger">{formErr}</Alert>}
        <Field label="Nama program studi" required>{(p) => <Input {...p} value={prog?.name ?? ''} onChange={(e) => prog && setProg({ ...prog, name: e.target.value })} />}</Field>
      </Dialog>
      <Dialog open={!!ref} title={`Skor acuan · ${ref?.name ?? ''}`} onClose={() => setRef(null)}
        footer={<><Button variant="secondary" onClick={() => setRef(null)}>Batal</Button>
          {ref && (ref.score || ref.source) && <Button variant="secondary" onClick={() => run(() => api(`/admin/study-programs/${ref.id}`, { method: 'PATCH', body: { reference: null } }), () => setRef(null))}>Hapus acuan</Button>}
          <Button loading={busy} disabled={!ref?.score}
            onClick={() => ref && run(() => api(`/admin/study-programs/${ref.id}`, { method: 'PATCH', body: { reference: { score: Number(ref.score), source: ref.source, year: Number(ref.year) || null } } }), () => setRef(null))}>Simpan</Button></>}>
        <div className="space-y-4">
          {formErr && <Alert tone="danger">{formErr}</Alert>}
          <p className="text-callout text-neutral-600">Skor acuan memakai skala sumbernya dan ditampilkan ke siswa sebagai konteks, tidak dibandingkan langsung dengan skor Cogniverse.</p>
          <Field label="Nilai acuan" required>{(p) => <Input {...p} type="number" value={ref?.score ?? ''} onChange={(e) => ref && setRef({ ...ref, score: e.target.value })} />}</Field>
          <Field label="Sumber" required help="Nama lembaga atau URL data.">{(p) => <Input {...p} value={ref?.source ?? ''} onChange={(e) => ref && setRef({ ...ref, source: e.target.value })} />}</Field>
          <Field label="Tahun data" required>{(p) => <Input {...p} type="number" min={2000} max={2100} value={ref?.year ?? ''} onChange={(e) => ref && setRef({ ...ref, year: e.target.value })} />}</Field>
        </div>
      </Dialog>
    </>
  );
}
