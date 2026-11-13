'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { ProfileForm } from '@/components/profile-form';
import { TargetForm } from '@/components/target-form';
import { safeNext } from '@/lib/nav';
import { useSession } from '@/lib/session';

function Onboarding() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('lanjut'));
  const { me, reload } = useSession();
  const [step, setStep] = useState<1 | 2>(1);
  useEffect(() => { if (me?.profileComplete) setStep(2); }, [me?.profileComplete]);
  return (
    <div className="mx-auto max-w-[560px]">
      <p className="text-footnote font-semibold text-neutral-600">{step} dari 2</p>
      {step === 1 ? (
        <>
          <PageHeader title="Tentang kamu" description="Data ini dipakai untuk laporan hasil dan tidak ditampilkan ke pengguna lain." />
          <Card><ProfileForm submitLabel="Lanjut" onDone={async () => { await reload(); setStep(2); }} /></Card>
        </>
      ) : (
        <>
          <PageHeader title="Target kamu" description="Pilih kampus dan jurusan tujuan. Kamu bisa mengubahnya kapan saja." />
          <Card><TargetForm submitLabel="Simpan Target" onDone={async () => { await reload(); router.replace(next ?? '/app'); }} /></Card>
        </>
      )}
    </div>
  );
}

/** STU-01 Onboarding (profil + target, UJ-01 langkah 3–4) */
export default function OnboardingPage() {
  return <Suspense><Onboarding /></Suspense>;
}
