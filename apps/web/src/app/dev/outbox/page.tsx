'use client';
import { useEffect, useState } from 'react';
import { PublicShell } from '@/components/shells';
import { Alert, Card, PageHeader } from '@/components/ui';
import { api, fmt } from '@/lib/api';

/** Hanya pengembangan: kotak keluar email (penyedia email belum dipilih, OQ-T3). */
export default function Outbox() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const load = () => api('/dev/outbox').then((r) => setRows(r.data)).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);
  return (
    <PublicShell>
      <PageHeader title="Kotak keluar email (dev)" description="Email transaksional yang dikirim aplikasi. Halaman ini tidak tersedia di produksi." />
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="space-y-3">
        {rows?.map((n) => (
          <Card key={n.id}>
            <p className="text-sm text-neutral-600">{fmt.dateTime(n.createdAt)} · {n.status}</p>
            <p className="font-medium">{n.template} → {n.recipient}</p>
            {n.payload?.link && <a className="break-all text-primary-600 underline" href={n.payload.link}>{n.payload.link}</a>}
          </Card>
        ))}
      </div>
    </PublicShell>
  );
}
