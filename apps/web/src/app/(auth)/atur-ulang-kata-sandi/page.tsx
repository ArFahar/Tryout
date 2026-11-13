'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PublicShell } from '@/components/shells';
import { Alert, Button, ButtonLink, Card, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [pw, setPw] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (done) return <Alert tone="success" title="Kata sandi diperbarui" action={<ButtonLink href="/masuk" size="sm">Masuk</ButtonLink>}>Semua sesi lain sudah dikeluarkan.</Alert>;
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      if (pw.length < 8) { setError('Kata sandi minimal 8 karakter.'); return; }
      setBusy(true); setError('');
      try { await api('/auth/password/reset', { method: 'POST', body: { token, newPassword: pw } }); setDone(true); }
      catch (err: any) { setError(err.message); } finally { setBusy(false); }
    }}>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Kata sandi baru" required help="Minimal 8 karakter.">{(p) => <Input {...p} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
      <Button type="submit" variant="solid" size="lg" className="w-full" loading={busy}>Simpan Kata Sandi</Button>
    </form>
  );
}

/** PUB-09 Atur ulang kata sandi */
export default function ResetPage() {
  return (
    <PublicShell narrow>
      <h1 className="text-2xl font-bold">Atur ulang kata sandi</h1>
      <Card className="mt-6"><Suspense><ResetForm /></Suspense></Card>
    </PublicShell>
  );
}
