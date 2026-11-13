'use client';
import Link from 'next/link';
import { useState } from 'react';
import { PublicShell } from '@/components/shells';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';

/** PUB-09 Lupa kata sandi: pesan selalu sama agar tidak mengungkap email terdaftar (TDD 5.1). */
export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <PublicShell narrow>
      <h1 className="text-2xl font-bold">Lupa kata sandi</h1>
      <Card className="mt-6">
        {sent ? (
          <Alert tone="success" title="Periksa email kamu">
            Jika {email} terdaftar, kami sudah mengirim tautan untuk mengatur ulang kata sandi. Tautan berlaku 60 menit.
          </Alert>
        ) : (
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault(); setBusy(true); setError('');
            try { await api('/auth/password/forgot', { method: 'POST', body: { email } }); setSent(true); }
            catch (err: any) { setError(err.message); } finally { setBusy(false); }
          }}>
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Email" required>{(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <Button type="submit" variant="solid" size="lg" className="w-full" loading={busy}>Kirim Tautan</Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm"><Link href="/masuk" className="font-medium text-primary-600 hover:underline">← Kembali ke Masuk</Link></p>
      </Card>
    </PublicShell>
  );
}
