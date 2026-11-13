'use client';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, ButtonLink, LoadingBlock, PageHeader, ProgressBar, Segmented, cx } from '@/components/ui';
import { EvidenceSheet, InsightCard, emphasize, type Insight } from '@/components/pi';
import { ExamTypeBadge } from '@/components/exam-card';
import { api, ApiError, fmt } from '@/lib/api';
import { CLASS_LABEL } from '@/lib/labels';

const SECTIONS = [
  ['keseluruhan', 'Keseluruhan'], ['subtes', 'Per subtes'], ['kemampuan', 'Kemampuan'],
  ['cara', 'Cara mengerjakan'], ['temuan', 'Area perbaikan'], ['langkah', 'Langkah berikutnya'],
] as const;
type SecId = (typeof SECTIONS)[number][0];
const DIFF: Record<string, string> = { EASY: 'Mudah', MEDIUM: 'Sedang', HARD: 'Sulit' };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function Section({ id, n, title, children }: { id: SecId; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-28 border-t border-neutral-200 pt-10 first:border-0 first:pt-0">
      <h2 id={`${id}-h`} className="flex items-baseline gap-3 text-title-2 font-bold">
        <span className="tabular text-headline font-semibold text-neutral-400" aria-hidden="true">{n}</span>{title}
      </h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** STU-08 Performance Intelligence (wireframe 5.9; EP-PI-01/02). Urutan enam bagian tetap (5.9.1). */
export default function Report({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [evidence, setEvidence] = useState<Insight | null>(null);
  const [current, setCurrent] = useState<SecId>('keseluruhan');
  const started = useRef(Date.now());
  const load = useCallback(() => { setError(null); api(`/attempts/${attemptId}/report`).then(setData).catch(setError); }, [attemptId]);
  useEffect(load, [load]);
  // Bagian 4–6 menunggu analisis: muat ulang tiap 3 detik, maks. 60 detik (STU-08 Loading)
  useEffect(() => {
    if (!data || !['PENDING', 'RUNNING'].includes(data.analysisStatus) || Date.now() - started.current > 60_000) return;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [data, load]);
  useEffect(() => {
    if (error?.code !== 'RESULT_PROCESSING') return;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [error, load]);
  // Tautan langsung ke bagian (#cara dsb.) setelah data termuat
  const hashDone = useRef(false);
  useEffect(() => {
    if (!data || hashDone.current) return;
    hashDone.current = true;
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [data]);
  // Penanda bagian yang sedang terlihat
  useEffect(() => {
    if (!data) return;
    // Bagian aktif = bagian terakhir yang sudah melewati garis baca (≥ 200 px atau 25% tinggi layar; header + bilah segmen mobile ±170 px)
    const onScroll = () => {
      let cur: SecId = SECTIONS[0][0];
      for (const [id] of SECTIONS) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top <= Math.max(200, window.innerHeight * 0.25)) cur = id; }
      setCurrent(cur);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [data]);
  const closeEvidence = useCallback(() => setEvidence(null), []);

  if (error) {
    if (error.code === 'RESULT_PROCESSING') return <p role="status" className="text-center text-neutral-600">Hasilmu sedang dihitung…</p>;
    return <Alert tone="danger" title="Laporan gagal dimuat" action={<Button size="sm" variant="secondary" onClick={load}>Coba Lagi</Button>}>{error.message}</Alert>;
  }
  if (!data) return <LoadingBlock />;

  const basic = data.reportTier === 'BASIC';
  const o = data.overview;
  const answered = o.correctCount + o.incorrectCount;
  const waiting = ['PENDING', 'RUNNING'].includes(data.analysisStatus);
  const failed = data.analysisStatus === 'FAILED' || (waiting && Date.now() - started.current > 60_000);
  const insights: Insight[] = data.insights;
  const findings = insights.filter((i) => i.dimension !== 'OVERVIEW');
  const groups = ['NEEDS_IMPROVEMENT', 'ADEQUATE', 'STRONG', null].map((k) => ({ k, items: data.topics.filter((t: any) => t.classification === k) }));
  const go = (id: SecId) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const pending = <p role="status" className="rounded-lg bg-neutral-50 p-5 text-neutral-600">Menyiapkan analisismu…</p>;
  const failedMsg = <Alert tone="warning">Analisis belum tersedia. Kami mencoba lagi otomatis — skor dan pembahasanmu sudah bisa dibuka.</Alert>;
  const analysis = (node: React.ReactNode) => (failed ? failedMsg : waiting ? pending : node);
  const limitations = <p className="text-footnote text-neutral-600">{data.limitations}</p>;

  return (
    <>
      <PageHeader title={`Analisis ${data.attempt.examTitle}`} back={{ href: `/app/hasil/${attemptId}`, label: 'Hasil' }}
        description={<span className="flex flex-wrap items-center gap-2">
          <ExamTypeBadge type={data.attempt.examType} />
          <span>{fmt.date(data.attempt.submittedAt)} · {data.attempt.submissionType === 'AUTO_TIMEOUT' ? 'Dikumpulkan otomatis' : 'Dikumpulkan sendiri'}</span>
          <Badge tone="neutral">{basic ? 'Laporan dasar' : 'Laporan lengkap'}</Badge>
        </span>} />

      {/* Mobile: kontrol bersegmen lekat di bawah header */}
      <div className="material-bar sticky top-14 z-20 -mx-5 mb-6 px-5 py-2 md:hidden">
        <Segmented label="Bagian laporan" value={current} onChange={go} options={SECTIONS.map(([v, l]) => ({ value: v, label: l }))} />
      </div>

      <div className="grid gap-10 md:grid-cols-[180px_minmax(0,980px)]">
        <nav aria-label="Bagian laporan" className="hidden md:block">
          <ol className="sticky top-24 space-y-1 text-callout">
            {SECTIONS.map(([id, l]) => (
              <li key={id}>
                <a href={`#${id}`} aria-current={current === id ? 'location' : undefined}
                  className={cx('block rounded-md px-3 py-2', current === id ? 'bg-white font-semibold text-neutral-900' : 'text-neutral-600 hover:text-neutral-900')}>{l}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="space-y-10 rounded-xl bg-white p-6 md:p-10">
          {/* 1 */}
          <Section id="keseluruhan" n={1} title="Performa keseluruhan">
            <div className="grid gap-6 sm:grid-cols-[220px_1fr]">
              <div>
                <p className="text-footnote text-neutral-600">Skor total</p>
                <p className="tabular text-title-1 font-bold">{Math.round(o.totalScore)}<span className="text-body font-normal text-neutral-600"> dari 1000</span></p>
              </div>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[['Akurasi', fmt.pct(o.accuracy)], ['Benar', o.correctCount], ['Salah', o.incorrectCount], ['Kosong', o.unansweredCount]].map(([k, v]) => (
                  <div key={k as string}><dt className="text-footnote text-neutral-600">{k}</dt><dd className="tabular text-title-3 font-semibold">{v}</dd></div>
                ))}
              </dl>
            </div>
            <p className="mt-4 text-callout text-neutral-600">{o.correctCount} benar dari {answered} soal yang dijawab · waktu pengerjaan {fmt.duration(o.durationSeconds)}</p>
            <Alert tone="info" className="mt-6">{data.disclaimer}</Alert>
          </Section>

          {/* 2 */}
          <Section id="subtes" n={2} title="Per subtes">
            <ul className="space-y-5">
              {data.sections.map((s: any) => (
                <li key={s.position}>
                  <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4">
                    <span>{s.name}</span>
                    <span className="tabular text-callout text-neutral-600"><span className="text-headline font-semibold text-neutral-900">{Math.round(s.scaledScore)}</span> · {s.correctCount} dari {s.questionCount} benar</span>
                  </div>
                  <ProgressBar value={s.scaledScore} max={1000} label={`${s.name}: ${Math.round(s.scaledScore)} dari 1000`} />
                </li>
              ))}
            </ul>
            <p className="mt-3 flex justify-between text-footnote text-neutral-600" aria-hidden="true"><span>0</span><span>500</span><span>1000</span></p>
          </Section>

          {/* 3 */}
          <Section id="kemampuan" n={3} title="Kemampuan per topik">
            {data.topics.length === 0 ? (
              <p className="text-neutral-600">Try out ini terlalu singkat untuk mengelompokkan topik. Lihat hasil per soal di pembahasan.</p>
            ) : (
              <div className="space-y-6">
                {groups.filter((g) => g.items.length).map((g) => (
                  <div key={String(g.k)}>
                    <h3 className="text-headline font-semibold">
                      {g.k ? CLASS_LABEL[g.k][0] : 'Data belum cukup'} <span className="font-normal text-neutral-600">· {g.items.length} topik</span>
                    </h3>
                    {g.k === null && <p className="mt-1 text-footnote text-neutral-600">Topik dengan kurang dari {data.thresholds.minQuestions} soal belum dikelompokkan.</p>}
                    <ul className="mt-3 divide-y divide-neutral-100">
                      {g.items.map((t: any) => (
                        <li key={t.topicId} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[1fr_140px_160px]">
                          <span>{t.topicName} <span className="text-footnote text-neutral-600">· {t.subjectName}</span></span>
                          <span className="tabular text-callout text-neutral-700 sm:text-right">{t.correctCount} dari {t.questionCount} benar</span>
                          <span className="col-span-2 flex items-center gap-3 sm:col-span-1">
                            <ProgressBar value={t.accuracy} className="flex-1" />
                            <span className="tabular w-10 text-right text-callout font-semibold">{fmt.pct(t.accuracy)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {basic && data.hiddenTopicCount > 0 && (
                  <p className="text-callout text-neutral-600">dan {data.hiddenTopicCount} topik lain — tersedia di laporan lengkap.</p>
                )}
                <p className="text-footnote text-neutral-600">
                  Kuat: akurasi {fmt.pct(data.thresholds.strong)} atau lebih. Perlu ditingkatkan: di bawah {fmt.pct(data.thresholds.weak)}. Minimal {data.thresholds.minQuestions} soal per topik.
                </p>
              </div>
            )}
          </Section>

          {/* 4 */}
          <Section id="cara" n={4} title="Cara mengerjakan">
            {data.behavior ? (
              <div className="space-y-6">
                <dl className="grid grid-cols-2 gap-4">
                  <div><dt className="text-footnote text-neutral-600">Waktu pengerjaan</dt><dd className="tabular text-title-3 font-semibold">{fmt.duration(data.behavior.durationSeconds)}</dd></div>
                  <div><dt className="text-footnote text-neutral-600">Soal kosong</dt><dd className="tabular text-title-3 font-semibold">{data.behavior.unansweredCount}</dd></div>
                </dl>
                {!basic && (
                  <>
                    <div>
                      <h3 className="text-headline font-semibold">Waktu per subtes <span className="font-normal text-neutral-600">· dipakai / tersedia</span></h3>
                      <ul className="mt-3 space-y-3">
                        {data.behavior.sectionTime.map((s: any) => (
                          <li key={s.attemptSectionId}>
                            <div className="mb-1 flex justify-between gap-4 text-callout"><span>{s.name}</span><span className="tabular">{mmss(s.usedSeconds)} / {mmss(s.allottedSeconds)}</span></div>
                            <ProgressBar value={s.usedSeconds} max={Math.max(1, s.allottedSeconds)} />
                          </li>
                        ))}
                      </ul>
                      {data.behavior.sectionTime.some((s: any) => s.indicative) && <p className="mt-2 text-footnote text-neutral-600">Timer try out ini berlaku untuk seluruh ujian, jadi waktu per subtes dihitung dari waktu di tiap soal dan bersifat perkiraan.</p>}
                    </div>
                    <div>
                      <h3 className="text-headline font-semibold">Akurasi per tingkat kesulitan</h3>
                      <p className="mt-2 text-callout">
                        {Object.entries(data.behavior.accuracyByDifficulty as Record<string, { n: number; correct: number }>)
                          .filter(([k]) => DIFF[k]).sort(([a], [b]) => Object.keys(DIFF).indexOf(a) - Object.keys(DIFF).indexOf(b))
                          .map(([k, v]) => `${DIFF[k]} ${v.correct} dari ${v.n} (${fmt.pct(v.correct / v.n)})`).join(' · ') || 'Belum ada data tingkat kesulitan.'}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-headline font-semibold">Perubahan jawaban</h3>
                      <p className="mt-2 text-callout">
                        {data.behavior.answerChanges.total === 0 ? 'Kamu tidak mengubah jawaban setelah memilih.'
                          : `${data.behavior.answerChanges.total} kali · ${data.behavior.answerChanges.wrongToRight} menjadi benar · ${data.behavior.answerChanges.rightToWrong} menjadi salah`}
                      </p>
                    </div>
                  </>
                )}
                {data.lockedSections.map((l: any) => (
                  <div key={l.key} className="rounded-lg bg-neutral-50 p-5">
                    <p className="text-headline font-semibold">{l.title}</p>
                    <p className="mt-1 text-callout text-neutral-600">{l.description}</p>
                    <ButtonLink href="/paket" variant="link" className="mt-2">Lihat paket</ButtonLink>
                  </div>
                ))}
              </div>
            ) : analysis(null)}
          </Section>

          {/* 5 */}
          <Section id="temuan" n={5} title="Kekuatan dan area perbaikan">
            {analysis(findings.length === 0
              ? <p className="text-neutral-600">Belum ada temuan yang cukup kuat dari try out ini.</p>
              : <div className="grid gap-4">{findings.map((i) => <InsightCard key={i.id} insight={i} onEvidence={setEvidence} />)}</div>)}
          </Section>

          {/* 6 */}
          <Section id="langkah" n={6} title="Langkah berikutnya">
            {analysis(data.recommendations.length === 0
              ? <p className="text-neutral-600">Belum ada area prioritas dari try out ini. Buka pembahasan untuk mempelajari soal yang belum benar.</p>
              : (
                <ol className="space-y-4">
                  {data.recommendations.map((r: any, idx: number) => (
                    <li key={r.id} className={cx('rounded-lg p-5', idx === 0 ? 'ring-2 ring-primary-600' : 'bg-neutral-50')}>
                      <p className="flex gap-3"><span className="tabular font-semibold text-primary-600">{r.rank}</span><span>{emphasize(r.text)}</span></p>
                      {r.action && <p className="mt-1 pl-7 text-callout text-neutral-600">{r.action.text}</p>}
                      <div className="mt-3 pl-7">
                        {idx === 0
                          ? <ButtonLink href={`/app/hasil/${attemptId}/pembahasan?topik=${r.target.topicId}`}>Pelajari soal-soal ini</ButtonLink>
                          : <ButtonLink href={`/app/hasil/${attemptId}/pembahasan?topik=${r.target.topicId}`} variant="link">Pelajari soal-soal ini</ButtonLink>}
                      </div>
                    </li>
                  ))}
                </ol>
              ))}
            <div className="mt-6"><ButtonLink href="/app/roadmap" variant="link">Buka roadmap</ButtonLink></div>
            <div className="mt-8 space-y-2">{limitations}<p className="text-footnote text-neutral-600">{data.disclaimer}</p></div>
          </Section>
        </div>
      </div>
      <EvidenceSheet attemptId={attemptId} insight={evidence} onClose={closeEvidence} />
    </>
  );
}
