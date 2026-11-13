'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PRIVACY_VERSION, TERMS_VERSION } from '@cogniverse/contracts';
import { PublicShell } from '@/components/shells';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { safeNext } from '@/lib/nav';

function RegisterForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = safeNext(sp.get('lanjut'));
  const { reload } = useSession();
  const [f, setF] = useState({ fullName: '', email: '', password: '', agree: false, referralCode: (sp.get('ref') ?? '').toUpperCase().slice(0, 10) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const rules = [
    { ok: f.password.length >= 8, label: 'Minimal 8 karakter' },
  ];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!f.fullName.trim()) local.fullName = 'Nama wajib diisi.';
    if (!/^\S+@\S+\.\S+$/.test(f.email)) local.email = 'Format email tidak valid.';
    if (f.password.length < 8) local.password = 'Kata sandi minimal 8 karakter.';
    if (!f.agree) local.agree = 'Kamu perlu menyetujui Syarat & Ketentuan dan Kebijakan Privasi.';
    setErrors(local);
    if (Object.keys(local).length) { document.getElementById('ringkasan-error')?.focus(); return; }
    setBusy(true);
    setError(null);
    try {
      await api('/auth/register', { method: 'POST', body: { fullName: f.fullName, email: f.email, password: f.password, acceptedTermsVersion: TERMS_VERSION, acceptedPrivacyVersion: PRIVACY_VERSION, referralCode: f.referralCode.trim() || undefined } });
      await reload();
      router.replace(`/app/onboarding${next ? `?lanjut=${encodeURIComponent(next)}` : ''}`);
    } catch (err) {
      const ae = err as ApiError;
      setError(ae);
      if (ae.details) setErrors(Object.fromEntries(ae.details.map((d) => [d.field ?? '', d.message])));
      setBusy(false);
    }
  }
  const n = Object.keys(errors).length;
  return (
    <Card className="mt-6">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div id="ringkasan-error" tabIndex={-1}>
          {n > 0 && !error && <Alert tone="danger" title={`Ada ${n} isian yang perlu diperbaiki`} />}
          {error && (
            <Alert tone="danger" action={error.code === 'EMAIL_ALREADY_REGISTERED' ? <Link className="font-medium underline" href="/masuk">Masuk</Link> : undefined}>
              {error.message}
            </Alert>
          )}
        </div>
        <Field label="Nama lengkap" required error={errors.fullName}>{(p) => <Input {...p} autoComplete="name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />}</Field>
        <Field label="Email" required error={errors.email}>{(p) => <Input {...p} type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Kata sandi" required error={errors.password}>{(p) => (
          <>
            <Input {...p} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            <ul className="mt-2 space-y-1 text-sm" aria-live="polite">
              {rules.map((r) => <li key={r.label} className={r.ok ? 'text-success-700' : 'text-neutral-600'}>{r.ok ? '✓' : '○'} {r.label}</li>)}
            </ul>
          </>
        )}</Field>
        <Field label="Kode referral (opsional)" help={f.referralCode ? 'Kode temanmu. Kosongkan bila tidak dipakai.' : 'Isi bila kamu diajak teman.'}>{(p) => (
          <Input {...p} autoCapitalize="characters" value={f.referralCode} onChange={(e) => setF({ ...f, referralCode: e.target.value.toUpperCase().slice(0, 10) })} />
        )}</Field>
        <div>
          <label className="flex items-start gap-3 py-2">
            <input type="checkbox" aria-labelledby="setuju-label" className="mt-1 h-5 w-5 accent-[var(--color-primary-600)]" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} aria-invalid={!!errors.agree} />
            <span id="setuju-label" className="text-sm">Saya menyetujui <Link href="/syarat-ketentuan" target="_blank" className="font-medium text-primary-600 underline">Syarat &amp; Ketentuan</Link> dan <Link href="/kebijakan-privasi" target="_blank" className="font-medium text-primary-600 underline">Kebijakan Privasi</Link>.</span>
          </label>
          {errors.agree && <p className="text-sm text-danger-700">⚠ {errors.agree}</p>}
        </div>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Daftar Gratis</Button>
      </form>
      <p className="mt-6 text-center text-sm text-neutral-600">Sudah punya akun? <Link href="/masuk" className="font-medium text-primary-600 hover:underline">Masuk</Link></p>
    </Card>
  );
}

/** PUB-07 Registration */
export default function RegisterPage() {
  return (
    <PublicShell narrow>
      <h1 className="text-title-2 font-bold">Daftar gratis</h1>
      <p className="mt-1 text-neutral-600">Setelah ini kamu memilih kampus dan jurusan tujuan. Try out mulai Rp35.000.</p>
      <Suspense><RegisterForm /></Suspense>
    </PublicShell>
  );
}
