'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PublicShell } from '@/components/shells';
import { Alert, ButtonLink, Card, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { homeFor, useSession } from '@/lib/session';

function Verify() {
  const token = useSearchParams().get('token');
  const { me, reload } = useSession();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [msg, setMsg] = useState('');
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (!token) { setState('error'); setMsg('Tautan verifikasi tidak lengkap.'); return; }
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(async () => { setState('ok'); await reload(); })
      .catch((e) => { setState('error'); setMsg(e.message); });
  }, [token, reload]);
  if (state === 'loading') return <p className="flex items-center gap-2" role="status"><Spinner /> Memverifikasi email…</p>;
  if (state === 'ok') {
    return (
      <Alert tone="success" title="Email berhasil diverifikasi"
        action={<ButtonLink href={me ? homeFor(me) : '/masuk'} size="sm">{me ? 'Lanjut ke Dashboard' : 'Masuk'}</ButtonLink>}>
        Sekarang kamu dapat mengklaim ujian gratis.
      </Alert>
    );
  }
  return (
    <Alert tone="danger" title="Verifikasi gagal" action={<ButtonLink href={me ? '/app' : '/masuk'} variant="secondary" size="sm">{me ? 'Kirim ulang dari Dashboard' : 'Masuk untuk kirim ulang'}</ButtonLink>}>
      {msg}
    </Alert>
  );
}

/** PUB-08 Verifikasi Email */
export default function VerifyPage() {
  return (
    <PublicShell narrow>
      <h1 className="text-2xl font-bold">Verifikasi email</h1>
      <Card className="mt-6"><Suspense><Verify /></Suspense></Card>
    </PublicShell>
  );
}
