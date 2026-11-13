'use client';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Dialog, EmptyState, Field, Input, LoadingBlock, PageHeader, Textarea } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

/** ADM-14 Musim Try Out (EP-SER-01..03, v3.0): tanggal SNBT menentukan akses Lifetime (H-7) dan horizon roadmap. */
export default function Seasons() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', name: '', description: '', examDate: '' });
  const [dateEdit, setDateEdit] = useState<{ id: string; name: string; value: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formErr, setFormErr] = useState('');
  const load = () => { setError(''); api('/admin/series').then((r) => setRows(r.data)).catch((e) => setError(e.message)); };
  useEffect(load, []);
  async function create() {
    setBusy('create'); setFormErr('');
    try {
      await api('/admin/series', { method: 'POST', body: { ...f, code: f.code.trim().toUpperCase(), description: f.description || undefined, examDate: f.examDate || null } });
      setOpen(false); setF({ code: '', name: '', description: '', examDate: '' }); load();
    } catch (e) { setFormErr((e as ApiError).details?.map((d) => d.message).join(' ') || (e as ApiError).message); }
    finally { setBusy(null); }
  }
  async function patch(id: string, body: any) {
    setBusy(id);
    try { await api(`/admin/series/${id}`, { method: 'PATCH', body }); load(); }
    catch (e) { setError((e as ApiError).message); }
    finally { setBusy(null); }
  }
  return (
    <>
      <PageHeader title="Musim try out" description="Satu musim = satu tahun SNBT berisi beberapa periode Full Try Out yang setara. Tanggal SNBT dipakai untuk masa berlaku paket dan roadmap siswa."
        actions={<Button onClick={() => setOpen(true)}>Buat Musim</Button>} />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {rows?.some((s) => s.status === 'ACTIVE' && !s.examDate) && (
        <Alert tone="warning" className="mb-4">Musim tanpa tanggal SNBT: paket tidak dapat dijual dan roadmap memakai horizon 8 minggu.</Alert>
      )}
      {!rows ? <LoadingBlock /> : rows.length === 0 ? <EmptyState title="Belum ada musim" /> : (
        <div className="overflow-x-auto rounded-lg bg-white">
          <table className="w-full min-w-[680px] text-left text-callout">
            <thead className="border-b border-neutral-200 text-footnote text-neutral-600">
              <tr><th className="px-4 py-3 font-normal">Musim</th><th className="px-4 py-3 font-normal">Tanggal SNBT</th><th className="px-4 py-3 text-right font-normal">Periode</th><th className="px-4 py-3 font-normal">Status</th><th className="px-4 py-3"><span className="sr-only">Aksi</span></th></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-neutral-100">
                  <td className="px-4 py-3"><p className="font-semibold">{s.name}</p><p className="text-footnote text-neutral-600">{s.code}{s.description ? ` · ${s.description}` : ''}</p></td>
                  <td className="tabular px-4 py-3">{s.examDate ?? <span className="text-warning-700">Belum ditetapkan</span>}
                    <Button size="sm" variant="plain" className="ml-2" onClick={() => setDateEdit({ id: s.id, name: s.name, value: s.examDate ?? '' })}>Ubah</Button></td>
                  <td className="tabular px-4 py-3 text-right">{s.examCount}</td>
                  <td className="px-4 py-3"><Badge tone={s.status === 'ACTIVE' ? 'success' : 'neutral'}>{s.status === 'ACTIVE' ? 'Aktif' : 'Diarsipkan'}</Badge></td>
                  <td className="px-4 py-3 text-right"><Button size="sm" variant="plain" loading={busy === s.id} onClick={() => patch(s.id, { status: s.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' })}>{s.status === 'ACTIVE' ? 'Arsipkan' : 'Aktifkan'}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open} title="Buat musim" onClose={() => setOpen(false)}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Batal</Button>
          <Button loading={busy === 'create'} disabled={f.name.trim().length < 3 || !/^[A-Z0-9-]{2,40}$/.test(f.code.trim().toUpperCase())} onClick={create}>Buat Musim</Button></>}>
        <div className="space-y-4">
          {formErr && <Alert tone="danger">{formErr}</Alert>}
          <Field label="Nama" required>{(p) => <Input {...p} data-autofocus placeholder="Try Out SNBT 2027" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Kode" required help="Huruf kapital, angka, dan tanda hubung. Contoh: SNBT-2027">{(p) => <Input {...p} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
          <Field label="Tanggal SNBT" help="Isi bila sudah diumumkan resmi.">{(p) => <Input {...p} type="date" value={f.examDate} onChange={(e) => setF({ ...f, examDate: e.target.value })} />}</Field>
          <Field label="Deskripsi">{(p) => <Textarea {...p} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        </div>
      </Dialog>
      <Dialog open={!!dateEdit} title={`Tanggal SNBT · ${dateEdit?.name ?? ''}`} onClose={() => setDateEdit(null)}
        footer={<><Button variant="secondary" onClick={() => setDateEdit(null)}>Batal</Button>
          <Button loading={busy === dateEdit?.id} onClick={async () => { if (dateEdit) { await patch(dateEdit.id, { examDate: dateEdit.value || null }); setDateEdit(null); } }}>Simpan</Button></>}>
        <p className="text-callout text-neutral-600">Mengubah tanggal tidak mengubah masa berlaku paket yang sudah dibeli.</p>
        <Field label="Tanggal SNBT">{(p) => <Input {...p} type="date" value={dateEdit?.value ?? ''} onChange={(e) => dateEdit && setDateEdit({ ...dateEdit, value: e.target.value })} />}</Field>
      </Dialog>
    </>
  );
}
