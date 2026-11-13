'use client';
import { use, useEffect, useState } from 'react';
import { Alert, Button, ButtonLink, Card, LoadingBlock, PageHeader, ProgressBar } from '@/components/ui';
import { api, ApiError, fmt } from '@/lib/api';

/** STU-07 Exam Results (wireframe 5.8). */
export default function Result({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = () => { setError(null); api(`/attempts/${attemptId}/result`).then(setData).catch(setError); };
  useEffect(load, [attemptId]);
  useEffect(() => {
    if (error?.code !== 'RESULT_PROCESSING') return;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    if (error.code === 'RESULT_PROCESSING') return <Card className="mx-auto max-w-md text-center"><p className="font-medium" role="status">Hasil sedang diproses…</p><p className="mt-1 text-sm text-neutral-600">Halaman ini akan diperbarui otomatis.</p></Card>;
    if (error.code === 'RESULT_NOT_PUBLISHED') return <Card className="mx-auto max-w-md text-center"><p className="text-lg font-medium">Hasil belum diumumkan</p><p className="mt-1 text-neutral-600">{error.message}</p><ButtonLink href="/app" variant="secondary" className="mt-4">Kembali ke Ringkasan</ButtonLink></Card>;
    return <Alert tone="danger" title="Hasil gagal dimuat" action={<Button size="sm" variant="secondary" onClick={load}>Coba Lagi</Button>}>{error.message}</Alert>;
  }
  if (!data) return <LoadingBlock />;
  const { attempt, result, sections, review } = data;
  const answered = result.correctCount + result.incorrectCount;

  return (
    <>
      <PageHeader title={attempt.examTitle} back={{ href: '/app/riwayat', label: 'Riwayat' }}
        description={`${fmt.date(attempt.submittedAt)} · ${attempt.submissionType === 'AUTO_TIMEOUT' ? 'Dikumpulkan otomatis saat waktu habis' : 'Dikumpulkan sendiri'}${attempt.attemptNumber > 1 ? ` · percobaan ke-${attempt.attemptNumber}` : ''}`} />
      <div className="space-y-6">
        {result.isRevised && <Alert tone="info">Skor ini diperbarui karena koreksi kunci jawaban.</Alert>}
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <Card className="flex flex-col justify-center rounded-lg">
            <p className="text-sm font-medium text-neutral-600">Skor total</p>
            <p className="text-[56px] font-bold leading-none tracking-[-0.015em] tabular text-neutral-900">{Math.round(result.totalScore)}</p>
            <p className="mt-1 text-neutral-600">dari 1000</p>
          </Card>
          <Card>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ['Akurasi', fmt.pct(result.accuracy), `${result.correctCount} benar dari ${answered} dijawab`],
                ['Benar', result.correctCount, null],
                ['Salah', result.incorrectCount, null],
                ['Kosong', result.unansweredCount, null],
              ].map(([k, v, h]) => (
                <div key={k as string}><dt className="text-sm text-neutral-600">{k}</dt><dd className="text-2xl font-bold tabular">{v}</dd>{h && <p className="text-xs text-neutral-600">{h}</p>}</div>
              ))}
            </dl>
            <p className="mt-4 text-sm text-neutral-600">Waktu pengerjaan {fmt.duration(result.durationSeconds)} · {fmt.pct(result.completionRate)} soal dijawab</p>
          </Card>
        </div>
        <Alert tone="info">{result.disclaimer}</Alert>

        <Card>
          <h2 className="text-lg font-medium">Skor per subtes</h2>
          <ul className="mt-4 space-y-4">
            {sections.map((s: any) => (
              <li key={s.position}>
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-sm text-neutral-600 tabular"><span className="text-base font-bold text-neutral-800">{Math.round(s.scaledScore)}</span> · {s.correctCount}/{s.questionCount} benar</span>
                </div>
                <ProgressBar value={s.scaledScore} max={1000} label={`${s.name}: ${Math.round(s.scaledScore)} dari 1000`} />
              </li>
            ))}
          </ul>
        </Card>

        <Card variant="highlight">
          <h2 className="text-title-3 font-semibold">Apa artinya skor ini?</h2>
          <p className="mt-1 text-neutral-600">Lihat subtes dan topik yang paling memengaruhi hasilmu.</p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <ButtonLink href={`/app/hasil/${attemptId}/laporan`} size="lg">Lihat analisis lengkap</ButtonLink>
            {review.available
              ? <ButtonLink href={`/app/hasil/${attemptId}/pembahasan`} variant="secondary" size="lg">Buka Pembahasan</ButtonLink>
              : <span className="flex items-center gap-2 text-callout text-neutral-600"><Button variant="secondary" size="lg" disabled>Buka Pembahasan</Button>Dibuka {fmt.dateTime(review.availableAt)}</span>}
          </div>
        </Card>
      </div>
    </>
  );
}
