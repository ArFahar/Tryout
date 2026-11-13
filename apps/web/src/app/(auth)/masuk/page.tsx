'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PublicShell } from '@/components/shells';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { homeFor, useSession } from '@/lib/session';
import { safeNext } from '@/lib/nav';


function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('lanjut'));
  const { reload } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/login', { method: 'POST', body: { email, password } });
      const me = await reload();
      router.replace(next ?? (me ? homeFor(me) : '/'));
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <Card className="mt-6">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Email" required>{(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Kata sandi" required>{(p) => (
          <div className="relative">
            <Input {...p} type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="pr-24" />
            <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm px-2 py-1 text-sm font-medium text-primary-600" aria-pressed={show}>
              {show ? 'Sembunyikan' : 'Tampilkan'}
            </button>
          </div>
        )}</Field>
        <div className="text-right"><Link href="/lupa-kata-sandi" className="text-sm font-medium text-primary-600 hover:underline">Lupa kata sandi?</Link></div>
        <Button type="submit" variant="solid" size="lg" className="w-full" loading={busy}>Masuk</Button>
      </form>
      <p className="mt-6 text-center text-sm text-neutral-600">
        Belum punya akun? <Link href={`/daftar${next ? `?lanjut=${encodeURIComponent(next)}` : ''}`} className="font-medium text-primary-600 hover:underline">Daftar</Link>
      </p>
    </Card>
  );
}

/** PUB-06 Login */
export default function LoginPage() {
  return (
    <PublicShell narrow>
      <h1 className="text-2xl font-bold">Masuk ke Cogniverse</h1>
      <Suspense><LoginForm /></Suspense>
    </PublicShell>
  );
}
