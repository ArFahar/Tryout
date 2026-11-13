'use client';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Dialog, EmptyState, Field, Input, LoadingBlock, PageHeader } from '@/components/ui';
import { api, ApiError, fmt } from '@/lib/api';

const TYPE: Record<string, string> = { SINGLE: 'Try Out Umum (1x)', BUNDLE: 'Bundle', LIFETIME: 'Lifetime' };

/** ADM-15 Paket (EP-PKG-04..06): harga berlaku untuk pesanan baru. */
export default function PackagesAdmin() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<{ id: string; name: string; price: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const load = () => { setError(''); api('/admin/packages').then((r) => setRows(r.data)).catch((e) => setError(e.message)); };
  useEffect(load, []);
  async function save() {
    if (!edit) return;
    setBusy(true); setFormErr('');
    try { await api(`/admin/packages/${edit.id}`, { method: 'PATCH', body: { name: edit.name, priceAmount: Number(edit.price) } }); setEdit(null); load(); }
    catch (e) { setFormErr((e as ApiError).details?.map((d) => d.message).join(' ') || (e as ApiError).message); }
    finally { setBusy(false); }
  }
  async function toggle(p: any) {
    try { await api(`/admin/packages/${p.id}`, { method: 'PATCH', body: { status: p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } }); load(); }
    catch (e) { setError((e as ApiError).message); }
  }
  return (
    <>
      <PageHeader title="Paket" description="Tiga paket per musim: Try Out Umum (1 kredit), Bundle (4 kredit), dan Lifetime (semua periode sampai H-7 SNBT)." />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {!rows ? <LoadingBlock /> : rows.length === 0 ? <EmptyState title="Belum ada paket" /> : (
        <div className="overflow-x-auto rounded-lg bg-white">
          <table className="w-full min-w-[720px] text-left text-callout">
            <thead className="border-b border-neutral-200 text-footnote text-neutral-600">
              <tr><th className="px-4 py-3 font-normal">Paket</th><th className="px-4 py-3 font-normal">Musim</th><th className="px-4 py-3 text-right font-normal">Harga</th><th className="px-4 py-3 text-right font-normal">Kredit</th><th className="px-4 py-3 text-right font-normal">Terjual</th><th className="px-4 py-3 font-normal">Status</th><th className="px-4 py-3"><span className="sr-only">Aksi</span></th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-neutral-100">
                  <td className="px-4 py-3"><p className="font-semibold">{p.name}</p><p className="text-footnote text-neutral-600">{TYPE[p.type]}</p></td>
                  <td className="px-4 py-3">{p.seriesName}</td>
                  <td className="tabular px-4 py-3 text-right">{fmt.rupiah(p.priceAmount)}</td>
                  <td className="tabular px-4 py-3 text-right">{p.tryoutCredits ?? 'Semua periode'}</td>
                  <td className="tabular px-4 py-3 text-right">{p.sold}</td>
                  <td className="px-4 py-3"><Badge tone={p.status === 'ACTIVE' ? 'success' : 'neutral'}>{p.status === 'ACTIVE' ? 'Dijual' : 'Tidak dijual'}</Badge></td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Button size="sm" variant="plain" onClick={() => setEdit({ id: p.id, name: p.name, price: String(p.priceAmount) })}>Ubah</Button>
                    <Button size="sm" variant="plain" className="ml-2" onClick={() => toggle(p)}>{p.status === 'ACTIVE' ? 'Hentikan' : 'Jual lagi'}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={!!edit} title="Ubah paket" onClose={() => setEdit(null)}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Batal</Button><Button loading={busy} disabled={!edit || !(Number(edit.price) > 0)} onClick={save}>Simpan</Button></>}>
        <div className="space-y-4">
          {formErr && <Alert tone="danger">{formErr}</Alert>}
          <Field label="Nama" required>{(p) => <Input {...p} value={edit?.name ?? ''} onChange={(e) => edit && setEdit({ ...edit, name: e.target.value })} />}</Field>
          <Field label="Harga (rupiah)" required help="Berlaku untuk pesanan baru; pesanan yang sudah dibuat memakai harga lama.">{(p) => <Input {...p} type="number" min={1} value={edit?.price ?? ''} onChange={(e) => edit && setEdit({ ...edit, price: e.target.value })} />}</Field>
        </div>
      </Dialog>
    </>
  );
}
