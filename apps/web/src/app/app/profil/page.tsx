'use client';
import { useState } from 'react';
import { Alert, Card, PageHeader } from '@/components/ui';
import { ProfileForm } from '@/components/profile-form';
import { useSession } from '@/lib/session';

/** STU-11 Profile */
export default function Profile() {
  const { me } = useSession();
  const [saved, setSaved] = useState(false);
  return (
    <div className="mx-auto max-w-[560px] space-y-6">
      <PageHeader title="Profil" />
      <Card>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="text-sm text-neutral-600">Nama</dt><dd className="font-medium">{me?.fullName}</dd></div>
          <div><dt className="text-sm text-neutral-600">Email</dt><dd className="font-medium">{me?.email} {me?.emailVerified ? '· terverifikasi' : '· belum terverifikasi'}</dd></div>
        </dl>
      </Card>
      <Card>
        <h2 className="mb-4 text-lg font-medium">Data siswa</h2>
        {saved && <Alert tone="success" className="mb-4">Profil tersimpan.</Alert>}
        <ProfileForm submitLabel="Simpan" onDone={() => setSaved(true)} />
      </Card>
    </div>
  );
}
