'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Button, ButtonLink, Card, LoadingBlock, PageHeader } from '@/components/ui';
import { RichContent } from '@/components/rich';
import { api, ApiError, fmt } from '@/lib/api';
import { startOrResume } from '@/lib/attempt-session';

/** STU-05 Exam Instructions (wireframe 5.6). */
export default function Instructions({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = use(params);
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [startErr, setStartErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/exams/${examId}/start-eligibility`).then(setData).catch((e) => setError(e.message)); }, [examId]);
  if (error) return <Alert tone="danger" title="Gagal memuat">{error}</Alert>;
  if (!data) return <LoadingBlock />;
  const { exam, eligibility } = data;
  const resuming = eligibility.canStart && eligibility.resumableAttemptId;

  async function start() {
    setBusy(true);
    setStartErr(null);
    try {
      const attemptId = await startOrResume(examId);
      router.push(`/ujian/${attemptId}`);
    } catch (e) {
      setStartErr(e as ApiError);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[720px]">
      <PageHeader title={exam.title} back={{ href: '/app/asesmen', label: 'Asesmen saya' }} />
      <div className="space-y-6">
        <Card>
          <dl className="grid grid-cols-3 gap-4">
            <div><dt className="text-sm text-neutral-600">Soal</dt><dd className="text-xl font-bold tabular">{exam.totalQuestions}</dd></div>
            <div><dt className="text-sm text-neutral-600">Durasi</dt><dd className="text-xl font-bold">{fmt.duration(exam.totalDurationSeconds)}</dd></div>
            <div><dt className="text-sm text-neutral-600">Timer</dt><dd className="text-xl font-bold">{exam.timingMode === 'PER_SECTION' ? 'Per subtes' : 'Total'}</dd></div>
          </dl>
        </Card>
        <Card>
          <h2 className="text-lg font-medium">Sebelum mulai</h2>
          <ul className="mt-3 space-y-2">
            {[
              exam.timingMode === 'PER_SECTION'
                ? 'Setiap subtes punya timer sendiri dan dikerjakan berurutan. Subtes yang sudah berakhir tidak bisa dibuka lagi, dan sisa waktunya tidak dipindahkan ke subtes berikutnya.'
                : 'Satu timer untuk seluruh ujian. Kamu bebas berpindah soal dan subtes.',
              'Timer dihitung di server dan tetap berjalan walaupun koneksi terputus, halaman ditutup, atau kamu berpindah perangkat.',
              'Jawaban tersimpan otomatis setiap kali kamu memilih opsi.',
              'Saat waktu habis, jawaban yang sudah tersimpan dikumpulkan otomatis.',
              'Tidak ada pengurangan nilai untuk jawaban salah.',
            ].map((t) => <li key={t} className="flex gap-3"><span className="mt-1 text-primary-600" aria-hidden="true">●</span><span>{t}</span></li>)}
          </ul>
          {exam.instructionsHtml && <RichContent className="mt-4 border-t border-neutral-100 pt-4 text-neutral-700" html={exam.instructionsHtml} />}
        </Card>
        <Card>
          <h2 className="text-lg font-medium">Susunan subtes</h2>
          <ol className="mt-3 divide-y divide-neutral-100">
            {exam.sections.map((s: any) => (
              <li key={s.position} className="flex justify-between py-2.5">
                <span>{s.position}. {s.name}</span>
                <span className="text-neutral-600 tabular">{s.questionCount} soal{s.durationSeconds ? ` · ${fmt.duration(s.durationSeconds)}` : ''}</span>
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-3">
          {startErr && <Alert tone="danger">{startErr.message}</Alert>}
          {eligibility.canStart ? (
            <>
              <Button variant="solid" size="lg" className="w-full sm:w-auto" loading={busy} onClick={start}>
                {resuming ? 'Lanjutkan Ujian' : 'Mulai Ujian'}
              </Button>
              {!resuming && <p className="text-sm text-neutral-600">Menekan Mulai Ujian memakai 1 dari {eligibility.attemptsRemaining} kesempatan yang tersisa, dan timer langsung berjalan.</p>}
              {resuming && <p className="text-sm text-neutral-600">Ujian sedang berlangsung dan waktunya terus berjalan.</p>}
            </>
          ) : eligibility.reasonCode === 'ANOTHER_ATTEMPT_IN_PROGRESS' ? (
            <Alert tone="warning" title="Ada ujian lain yang sedang berlangsung"
              action={<ButtonLink href={`/app/ujian/${eligibility.resumableExamId}/instruksi`} variant="secondary" size="sm">Buka ujian tersebut</ButtonLink>}>
              Selesaikan atau kumpulkan ujian itu terlebih dahulu.
            </Alert>
          ) : eligibility.reasonCode === 'ATTEMPT_LIMIT_REACHED' ? (
            <Alert tone="info" title="Kesempatan sudah habis" action={<Link className="font-medium underline" href="/app/riwayat">Lihat riwayat dan hasil</Link>}>
              {eligibility.message}
            </Alert>
          ) : (
            <Alert tone="warning">{eligibility.message}</Alert>
          )}
        </div>
      </div>
    </div>
  );
}
