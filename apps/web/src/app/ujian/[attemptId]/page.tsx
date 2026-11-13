'use client';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import type { AttemptStateDto, AttemptQuestionDto } from '@cogniverse/contracts';
import { Button, ButtonLink, Dialog, Spinner, cx } from '@/components/ui';
import { RichContent } from '@/components/rich';
import { api, ApiError, fmt } from '@/lib/api';
import { readAttemptSession, saveAttemptSession, startOrResume } from '@/lib/attempt-session';

/**
 * STU-06 Active Examination (UI/UX 5.7; TDD 6.2–6.3).
 * - Tenggat berasal dari server; klien hanya menampilkan memakai jam monoton + offset waktu server.
 * - Setiap perubahan jawaban menaikkan clientSeq, masuk antrean lokal lebih dulu, lalu dikirim (debounce 300 ms).
 */

type Answer = { selectedOptionId: string | null; isFlagged: boolean; clientSeq: number };
type SaveState = 'idle' | 'saving' | 'saved' | 'retrying' | 'offline';
type Screen = { kind: 'loading' } | { kind: 'exam' } | { kind: 'takeover' } | { kind: 'finished'; reason: 'manual' | 'timeout' | 'already'; lost?: number }
  | { kind: 'error'; message: string } | { kind: 'transition'; nextName: string; nextIndex: number; total: number; count: number };

const FONT_STEPS = [1, 1.15, 1.3];
const queueKey = (id: string) => `cv-queue:${id}`;

export default function ExamPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [state, setState] = useState<AttemptStateDto | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [index, setIndex] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(0);
  const [fontStep, setFontStep] = useState(0);
  const [dialog, setDialog] = useState<'submit' | 'end' | null>(null);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState(true);
  const [help, setHelp] = useState(false);

  const token = useRef<string | null>(null);
  const clock = useRef<{ server: number; perf: number } | null>(null);
  const pending = useRef<Record<string, Answer & { timeSpentMs: number }>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const backoff = useRef(1000);
  const spent = useRef<Record<string, number>>({});
  const shownAt = useRef<{ id: string; t: number } | null>(null);
  const warned = useRef<{ five: boolean; one: boolean; deadline: string | null }>({ five: false, one: false, deadline: null });
  const stopped = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const serverNow = useCallback(() => (clock.current ? clock.current.server + (performance.now() - clock.current.perf) : Date.now()), []);
  const syncClock = (serverTime: string, sentAt: number) => {
    const rtt = performance.now() - sentAt;
    clock.current = { server: new Date(serverTime).getTime() + rtt / 2, perf: performance.now() };
  };

  // ---------------------------------------------------------------- antrean lokal
  const persistQueue = () => {
    try { localStorage.setItem(queueKey(attemptId), JSON.stringify(pending.current)); } catch { /* penuh/privat */ }
  };
  const stop = useCallback((s: Screen) => {
    stopped.current = true;
    const lost = Object.keys(pending.current).length;
    pending.current = {};
    try { localStorage.removeItem(queueKey(attemptId)); } catch { /* */ }
    if (s.kind === 'finished' && s.reason === 'timeout') s = { ...s, lost };
    setScreen(s);
  }, [attemptId]);

  const handleFatal = useCallback((e: unknown) => {
    const err = e as ApiError;
    if (err.code === 'ATTEMPT_SESSION_TAKEN_OVER') { setScreen({ kind: 'takeover' }); return true; }
    if (err.code === 'ATTEMPT_EXPIRED' || err.code === 'ATTEMPT_NOT_IN_PROGRESS') { stop({ kind: 'finished', reason: 'timeout' }); return true; }
    return false;
  }, [stop]);

  const sendOne = useCallback(async (qid: string) => {
    if (stopped.current) return;
    const item = pending.current[qid];
    if (!item) return;
    setSaveState('saving');
    const sentAt = performance.now();
    try {
      const r = await api(`/attempts/${attemptId}/answers/${qid}`, {
        method: 'PUT', headers: { 'x-attempt-session': token.current ?? '' },
        body: { clientSeq: item.clientSeq, selectedOptionId: item.selectedOptionId, isFlagged: item.isFlagged, timeSpentMs: item.timeSpentMs },
      });
      syncClock(r.serverTime, sentAt);
      if (pending.current[qid]?.clientSeq === item.clientSeq) delete pending.current[qid];
      persistQueue();
      backoff.current = 1000;
      setSaveState(Object.keys(pending.current).length ? 'saving' : 'saved');
    } catch (e) {
      if (handleFatal(e)) return;
      const err = e as ApiError;
      if (err.code === 'SECTION_NOT_ACTIVE' || err.code === 'INVALID_OPTION' || err.code === 'QUESTION_NOT_IN_ATTEMPT') {
        delete pending.current[qid]; persistQueue(); setSaveState('saved'); return;
      }
      setSaveState(navigator.onLine ? 'retrying' : 'offline');
      const wait = backoff.current;
      backoff.current = Math.min(15000, backoff.current * 2);
      timers.current[qid] = setTimeout(() => sendOne(qid), wait);
    }
  }, [attemptId, handleFatal]);

  const flushAll = useCallback(async () => {
    const items = Object.entries(pending.current);
    if (!items.length || stopped.current) return;
    setSaveState('saving');
    const sentAt = performance.now();
    try {
      const r = await api(`/attempts/${attemptId}/answers/batch`, {
        method: 'POST', headers: { 'x-attempt-session': token.current ?? '' },
        body: { items: items.map(([questionId, a]) => ({ questionId, clientSeq: a.clientSeq, selectedOptionId: a.selectedOptionId, isFlagged: a.isFlagged, timeSpentMs: a.timeSpentMs })) },
      });
      syncClock(r.serverTime, sentAt);
      if (r.results.some((x: any) => x.code === 'ATTEMPT_EXPIRED' || x.code === 'ATTEMPT_NOT_IN_PROGRESS')) { stop({ kind: 'finished', reason: 'timeout' }); return; }
      for (const x of r.results) if (x.saved || x.code) delete pending.current[x.questionId];
      persistQueue();
      setSaveState(Object.keys(pending.current).length ? 'retrying' : 'saved');
    } catch (e) {
      if (handleFatal(e)) return;
      setSaveState(navigator.onLine ? 'retrying' : 'offline');
    }
  }, [attemptId, handleFatal, stop]);

  // ---------------------------------------------------------------- muat keadaan
  const load = useCallback(async (opts: { keepIndex?: boolean } = {}) => {
    try {
      if (!token.current) token.current = readAttemptSession(attemptId);
      if (!token.current) {
        const st = await api(`/attempts/${attemptId}/status`);
        if (st.status !== 'IN_PROGRESS') { stop({ kind: 'finished', reason: 'already' }); return; }
        await startOrResume(st.examId);
        token.current = readAttemptSession(attemptId);
      }
      const sentAt = performance.now();
      const s = await api<AttemptStateDto>(`/attempts/${attemptId}`, { headers: { 'x-attempt-session': token.current ?? '' } });
      syncClock(s.serverTime, sentAt);
      // Gabungkan jawaban server dengan antrean lokal berdasarkan clientSeq (EC-02)
      let local: Record<string, Answer & { timeSpentMs: number }> = {};
      try { local = JSON.parse(localStorage.getItem(queueKey(attemptId)) ?? '{}'); } catch { /* */ }
      const merged: Record<string, Answer> = {};
      for (const a of s.answers) merged[a.questionId] = { selectedOptionId: a.selectedOptionId, isFlagged: a.isFlagged, clientSeq: a.clientSeq };
      const visible = new Set(s.questions.map((q) => q.id));
      for (const [qid, a] of Object.entries(local)) {
        if (!visible.has(qid)) continue;
        if (!merged[qid] || merged[qid].clientSeq < a.clientSeq) { merged[qid] = a; pending.current[qid] = a; }
      }
      setAnswers((prev) => ({ ...prev, ...merged }));
      setState(s);
      if (!opts.keepIndex) setIndex(0);
      setScreen({ kind: 'exam' });
      setSaveState(Object.keys(pending.current).length ? 'saving' : 'idle');
      if (Object.keys(pending.current).length) flushAll();
    } catch (e) {
      if (handleFatal(e)) return;
      setScreen({ kind: 'error', message: (e as ApiError).message });
    }
  }, [attemptId, flushAll, handleFatal, stop]);

  useEffect(() => {
    load();
    try { setFontStep(Number(localStorage.getItem('cv-font-step') ?? 0) || 0); setShortcuts(localStorage.getItem('cv-shortcuts') !== 'off'); } catch { /* */ }
  }, [load]);

  // ---------------------------------------------------------------- jam & sinkronisasi
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(t);
  }, [serverNow]);
  useEffect(() => {
    const resync = async () => {
      if (stopped.current) return;
      const sentAt = performance.now();
      try {
        const st = await api(`/attempts/${attemptId}/status`);
        syncClock(st.serverTime, sentAt);
        if (st.status !== 'IN_PROGRESS') stop({ kind: 'finished', reason: 'timeout' });
      } catch { /* jaringan: tetap pakai offset terakhir */ }
    };
    const t = setInterval(resync, 60000);
    const onVis = () => document.visibilityState === 'visible' && resync();
    const onOnline = () => { setOnline(true); resync(); flushAll(); };
    const onOffline = () => { setOnline(false); setSaveState('offline'); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    setOnline(navigator.onLine);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [attemptId, flushAll, stop]);

  // Peringatan saat meninggalkan halaman
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (!stopped.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  // ---------------------------------------------------------------- turunan
  const activeSection = state?.sections.find((s) => s.status === 'ACTIVE') ?? null;
  const isPerSection = state?.attempt.timingMode === 'PER_SECTION';
  const deadlineIso = isPerSection ? activeSection?.deadlineAt : state?.attempt.expiresAt;
  const remaining = deadlineIso && now ? new Date(deadlineIso).getTime() - now : null;
  const questions = state?.questions ?? [];
  const q: AttemptQuestionDto | undefined = questions[index];
  const sectionOfQ = state?.sections.find((s) => s.id === q?.sectionId);
  const answeredCount = questions.filter((x) => answers[x.id]?.selectedOptionId).length;
  const flaggedCount = questions.filter((x) => answers[x.id]?.isFlagged).length;
  const isLastSection = isPerSection && activeSection ? !state!.sections.some((s) => s.position > activeSection.position && s.status === 'PENDING') : true;
  const timerLevel = remaining === null ? 'normal' : remaining <= 60000 ? 'critical' : remaining <= 300000 ? 'warning' : 'normal';

  // Toast peringatan 5 menit dan 1 menit, sekali per tenggat
  useEffect(() => {
    if (remaining === null || screen.kind !== 'exam') return;
    if (warned.current.deadline !== deadlineIso) warned.current = { five: remaining <= 300000, one: remaining <= 60000, deadline: deadlineIso ?? null };
    if (!warned.current.five && remaining <= 300000) { warned.current.five = true; setToast('Sisa 5 menit'); }
    if (!warned.current.one && remaining <= 60000) { warned.current.one = true; setToast('Sisa 1 menit'); }
  }, [remaining, deadlineIso, screen.kind]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }, [toast]);

  // Tenggat tercapai: subtes berikutnya dimulai otomatis, atau ujian dikumpulkan server
  const deadlineHandled = useRef<string | null>(null);
  useEffect(() => {
    if (remaining === null || remaining > 0 || screen.kind !== 'exam' || deadlineHandled.current === deadlineIso) return;
    deadlineHandled.current = deadlineIso ?? null;
    (async () => {
      await flushAll();
      if (isPerSection && !isLastSection) {
        const next = state!.sections.find((s) => s.status === 'PENDING')!;
        await load();
        setScreen({ kind: 'transition', nextName: next.name, nextIndex: next.position, total: state!.sections.length, count: next.questionCount });
      } else {
        setTimeout(async () => {
          try { await api(`/attempts/${attemptId}/status`); } catch { /* */ }
          stop({ kind: 'finished', reason: 'timeout' });
        }, 6000);
      }
    })();
  }, [remaining, screen.kind, deadlineIso, isPerSection, isLastSection, state, flushAll, load, attemptId, stop]);

  // Waktu per soal (FR-ENG-14)
  useEffect(() => {
    if (!q) return;
    const prev = shownAt.current;
    if (prev) spent.current[prev.id] = (spent.current[prev.id] ?? 0) + (performance.now() - prev.t);
    shownAt.current = { id: q.id, t: performance.now() };
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [q?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- aksi
  const update = useCallback((qid: string, patch: Partial<Answer>) => {
    if (stopped.current || (remaining !== null && remaining <= 0)) return;
    setAnswers((prev) => {
      const cur = prev[qid] ?? { selectedOptionId: null, isFlagged: false, clientSeq: 0 };
      const next = { ...cur, ...patch, clientSeq: Math.max(cur.clientSeq, pending.current[qid]?.clientSeq ?? 0) + 1 };
      const live = shownAt.current?.id === qid ? performance.now() - shownAt.current.t : 0;
      pending.current[qid] = { ...next, timeSpentMs: Math.round((spent.current[qid] ?? 0) + live) };
      persistQueue();
      clearTimeout(timers.current[qid]);
      timers.current[qid] = setTimeout(() => sendOne(qid), 300);
      setSaveState('saving');
      return { ...prev, [qid]: next };
    });
  }, [remaining, sendOne]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (i: number) => { if (i >= 0 && i < questions.length) setIndex(i); };

  async function submit() {
    setBusy(true);
    await flushAll();
    try {
      await api(`/attempts/${attemptId}/submit`, { method: 'POST' });
      stop({ kind: 'finished', reason: 'manual' });
    } catch (e) {
      if (!handleFatal(e)) setToast((e as ApiError).message);
    } finally { setBusy(false); setDialog(null); }
  }
  async function endSection() {
    if (!activeSection) return;
    setBusy(true);
    await flushAll();
    try {
      const r = await api(`/attempts/${attemptId}/sections/${activeSection.id}/end`, { method: 'POST', headers: { 'x-attempt-session': token.current ?? '' } });
      setDialog(null);
      if (r.submitted) { stop({ kind: 'finished', reason: 'manual' }); return; }
      const next = state!.sections.find((s) => s.status === 'PENDING')!;
      await load();
      setScreen({ kind: 'transition', nextName: next.name, nextIndex: next.position, total: state!.sections.length, count: next.questionCount });
    } catch (e) {
      if (!handleFatal(e)) setToast((e as ApiError).message);
    } finally { setBusy(false); }
  }
  async function takeBack() {
    if (!state) return;
    try {
      const r = await api('/attempts', { method: 'POST', body: { examId: state.attempt.examId } });
      saveAttemptSession(r.attempt.id, r.sessionToken);
      token.current = r.sessionToken;
      stopped.current = false;
      await load({ keepIndex: true });
    } catch (e) {
      if (!handleFatal(e)) setScreen({ kind: 'error', message: (e as ApiError).message });
    }
  }

  // Pintasan keyboard (5.7.6)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (screen.kind !== 'exam' || dialog || sheet || help || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight' && (e.target as HTMLElement)?.getAttribute('role') !== 'radio') { go(index + 1); return; }
      if (e.key === 'ArrowLeft' && (e.target as HTMLElement)?.getAttribute('role') !== 'radio') { go(index - 1); return; }
      if (!shortcuts || !q) return;
      const k = e.key.toUpperCase();
      const opt = q.options.find((o) => o.key === k);
      if (opt) { e.preventDefault(); update(q.id, { selectedOptionId: opt.id }); return; }
      if (k === 'N') go(index + 1);
      if (k === 'P') go(index - 1);
      if (k === 'R') update(q.id, { isFlagged: !answers[q.id]?.isFlagged });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------------------------------------------------------------- layar khusus
  if (screen.kind === 'loading') {
    return <FullScreen><Spinner className="h-6 w-6 text-primary-600" /><p className="mt-3" role="status">Menyiapkan ujian…</p></FullScreen>;
  }
  if (screen.kind === 'error') {
    return <FullScreen><h1 className="text-xl font-bold">Ujian tidak dapat dimuat</h1><p className="mt-2 text-neutral-600">{screen.message}</p><Button className="mt-6" onClick={() => { setScreen({ kind: 'loading' }); load(); }}>Coba Lagi</Button><p className="mt-3 text-sm text-neutral-600">Waktu tetap berjalan di server.</p></FullScreen>;
  }
  if (screen.kind === 'takeover') {
    return (
      <FullScreen>
        <h1 className="text-xl font-bold">Ujian ini sedang dibuka di perangkat lain.</h1>
        <p className="mt-2 text-neutral-600">Jawaban yang sudah tersimpan aman. Waktu tetap berjalan.</p>
        <Button variant="solid" size="lg" className="mt-6" onClick={takeBack}>Lanjutkan di Perangkat Ini</Button>
      </FullScreen>
    );
  }
  if (screen.kind === 'finished') {
    return (
      <FullScreen>
        <h1 className="text-xl font-bold" role="status">
          {screen.reason === 'timeout' ? 'Waktu habis — jawabanmu sudah dikumpulkan otomatis.' : screen.reason === 'already' ? 'Ujian ini sudah dikumpulkan.' : 'Jawabanmu sudah dikumpulkan.'}
        </h1>
        {screen.lost ? <p className="mt-2 text-secondary-700">{screen.lost} jawaban terakhir tidak sempat tersimpan karena koneksi terputus.</p> : null}
        <p className="mt-2 text-neutral-600">Hasil dan pembahasan tersedia sekarang.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href={`/app/hasil/${attemptId}`} variant="solid" size="lg">Lihat Hasil</ButtonLink>
          <ButtonLink href="/app" variant="secondary" size="lg">Kembali ke Dashboard</ButtonLink>
        </div>
      </FullScreen>
    );
  }
  if (screen.kind === 'transition') {
    return <Transition s={screen} remaining={remaining} onStart={() => setScreen({ kind: 'exam' })} />;
  }
  if (!state || !q) return <FullScreen><p>Tidak ada soal untuk ditampilkan.</p></FullScreen>;

  const scale = FONT_STEPS[fontStep];
  const a = answers[q.id];
  const lastQ = index === questions.length - 1;
  const contextLabel = isPerSection && activeSection
    ? `${activeSection.name} · Subtes ${activeSection.position}/${state.sections.length}`
    : `${state.attempt.examTitle}${sectionOfQ ? ` · ${sectionOfQ.name}` : ''}`;

  const grid = (
    <QuestionGrid questions={questions} answers={answers} index={index} onPick={(i) => { go(i); setSheet(false); }} />
  );
  const finishButton = isPerSection && !isLastSection
    ? <Button variant="secondary" className="w-full" onClick={() => setDialog('end')}>Akhiri Subtes</Button>
    : <Button variant="secondary" className="w-full" onClick={() => setDialog('submit')}>Kumpulkan Ujian</Button>;

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Bilah atas: konteks, status simpan, timer — tanpa navigasi aplikasi (5.7.3) */}
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white shadow-md">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3 px-4 py-2 lg:px-6">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-800 sm:text-base">{contextLabel}</p>
            <SaveIndicator state={saveState} />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setHelp(true)} className="hidden h-10 w-10 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 sm:flex" aria-label="Bantuan dan pintasan keyboard">?</button>
            <Timer ms={remaining} level={timerLevel} />
          </div>
        </div>
        {!online && (
          <div role="alert" className="border-t border-secondary-500 bg-secondary-50 px-4 py-2 text-sm text-secondary-700">
            Koneksi terputus. Jawabanmu disimpan di perangkat ini dan akan dikirim saat koneksi kembali. Waktu tetap berjalan.
          </div>
        )}
      </header>

      <div className="mx-auto grid max-w-[1280px] gap-6 px-4 pb-28 pt-4 lg:grid-cols-[1fr_280px] lg:px-6">
        <main className="min-w-0 rounded-md border border-neutral-200 bg-white p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 ref={headingRef} tabIndex={-1} className="text-base font-medium text-neutral-600 outline-none">
              Soal {q.number} dari {state.attempt.totalQuestions}
            </h1>
            <div className="flex items-center gap-1">
              <button onClick={() => update(q.id, { isFlagged: !a?.isFlagged })} aria-pressed={!!a?.isFlagged}
                className={cx('flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium', a?.isFlagged ? 'border-secondary-500 bg-secondary-50 text-secondary-700' : 'border-neutral-200 text-neutral-700 hover:border-neutral-500')}>
                <FlagIcon filled={!!a?.isFlagged} /> Ragu-ragu
              </button>
              <button className="h-10 w-10 rounded-md text-sm font-medium hover:bg-neutral-100 disabled:opacity-40" aria-label="Perkecil teks" disabled={fontStep === 0}
                onClick={() => { const v = Math.max(0, fontStep - 1); setFontStep(v); localStorage.setItem('cv-font-step', String(v)); }}>A−</button>
              <button className="h-10 w-10 rounded-md text-base font-medium hover:bg-neutral-100 disabled:opacity-40" aria-label="Perbesar teks" disabled={fontStep === FONT_STEPS.length - 1}
                onClick={() => { const v = Math.min(FONT_STEPS.length - 1, fontStep + 1); setFontStep(v); localStorage.setItem('cv-font-step', String(v)); }}>A+</button>
            </div>
          </div>

          <div className="mt-4 max-w-[72ch]" style={{ fontSize: `${17 * scale}px`, lineHeight: 1.65 }}>
            <RichContent html={q.stemHtml} className="text-neutral-800 sm:text-[1.0588em]" />
            <div role="radiogroup" aria-label={`Pilihan jawaban soal ${q.number}`} className="mt-5 space-y-2">
              {q.options.map((o) => {
                const sel = a?.selectedOptionId === o.id;
                return (
                  <div key={o.id} role="radio" aria-checked={sel} aria-label={`Opsi ${o.key}`} aria-describedby={`opt-${o.id}`} tabIndex={sel || (!a?.selectedOptionId && o.key === 'A') ? 0 : -1}
                    onClick={() => update(q.id, { selectedOptionId: o.id })}
                    onKeyDown={(e) => {
                      const i = q.options.findIndex((x) => x.id === o.id);
                      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); update(q.id, { selectedOptionId: o.id }); }
                      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); const n = q.options[(i + 1) % q.options.length]; update(q.id, { selectedOptionId: n.id }); (e.currentTarget.nextElementSibling as HTMLElement | null ?? e.currentTarget.parentElement?.firstElementChild as HTMLElement)?.focus(); }
                      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); const n = q.options[(i - 1 + q.options.length) % q.options.length]; update(q.id, { selectedOptionId: n.id }); (e.currentTarget.previousElementSibling as HTMLElement | null ?? e.currentTarget.parentElement?.lastElementChild as HTMLElement)?.focus(); }
                    }}
                    className={cx('flex min-h-12 cursor-pointer items-start gap-3 rounded-md px-4 py-3 transition-colors',
                      sel ? 'border-2 border-primary-600 bg-primary-50' : 'border border-neutral-200 hover:border-neutral-500')}>
                    <span className={cx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                      sel ? 'bg-primary-600 text-white' : 'border border-neutral-500 text-neutral-700')} aria-hidden="true">{o.key}</span>
                    <div id={`opt-${o.id}`} className="min-w-0 flex-1 pt-0.5"><RichContent html={o.contentHtml} /></div>
                    {sel && <span className="mt-1 shrink-0 text-primary-700" aria-hidden="true">✓</span>}
                    <span className="sr-only">{sel ? ', dipilih' : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {a?.selectedOptionId && (
            <button className="mt-4 text-sm font-medium text-primary-600 underline underline-offset-2" onClick={() => update(q.id, { selectedOptionId: null })}>
              Hapus jawaban
            </button>
          )}
        </main>

        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4 rounded-md border border-neutral-200 bg-white p-4">
            <div>
              <h2 className="font-medium">Daftar soal</h2>
              <p className="text-sm text-neutral-600 tabular">Terjawab {answeredCount} dari {questions.length}</p>
            </div>
            {grid}
            <Legend />
            {finishButton}
          </div>
        </aside>
      </div>

      {/* Bilah bawah lekat */}
      <nav aria-label="Navigasi soal" className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-md">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-2 px-4 py-2 lg:px-6">
          <Button variant="secondary" size="lg" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Soal sebelumnya">← <span className="hidden sm:inline">Sebelumnya</span></Button>
          <Button variant="secondary" size="lg" className="lg:hidden" onClick={() => setSheet(true)} aria-label="Buka daftar soal">▦ <span className="tabular">{index + 1}/{questions.length}</span></Button>
          {lastQ ? (
            isPerSection && !isLastSection
              ? <Button variant="solid" size="lg" onClick={() => setDialog('end')}>Akhiri Subtes</Button>
              : <Button variant="solid" size="lg" onClick={() => setDialog('submit')}>Kumpulkan</Button>
          ) : <Button variant="primary" size="lg" onClick={() => go(index + 1)} aria-label="Soal berikutnya"><span className="hidden sm:inline">Berikutnya</span><span className="sm:hidden">Berikut</span> →</Button>}
        </div>
      </nav>

      {/* Lembar daftar soal (mobile) */}
      {sheet && (
        <div className="fixed inset-0 z-40 flex items-end bg-neutral-900/50 lg:hidden" onClick={() => setSheet(false)}>
          <div role="dialog" aria-modal="true" aria-label="Daftar soal" className="w-full rounded-t-lg bg-white p-4 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-lg"
            onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && setSheet(false)}>
            <div className="mb-3 flex items-center justify-between">
              <div><h2 className="font-medium">Daftar soal</h2><p className="text-sm text-neutral-600 tabular">Terjawab {answeredCount} dari {questions.length}</p></div>
              <button onClick={() => setSheet(false)} className="h-11 w-11 rounded-full hover:bg-neutral-100" aria-label="Tutup" autoFocus>✕</button>
            </div>
            {grid}
            <div className="mt-3"><Legend /></div>
            <div className="mt-4">{finishButton}</div>
          </div>
        </div>
      )}

      <Dialog open={dialog === 'submit'} title="Kumpulkan ujian?" onClose={() => setDialog(null)}
        footer={<><Button variant="secondary" data-autofocus onClick={() => setDialog(null)}>Kembali ke Soal</Button><Button variant="solid" loading={busy} onClick={submit}>Ya, Kumpulkan</Button></>}>
        <Summary rows={[['Terjawab', `${answeredCount} dari ${questions.length}`], ['Belum dijawab', `${questions.length - answeredCount}`], ['Ragu-ragu', `${flaggedCount}`], ['Sisa waktu', fmt.clock(remaining ?? 0)]]} />
        {Object.keys(pending.current).length > 0 && <p className="mt-3 text-sm text-secondary-700">{Object.keys(pending.current).length} jawaban belum tersinkron — sedang dikirim…</p>}
        <p className="mt-3">Setelah dikumpulkan, jawaban tidak dapat diubah lagi.</p>
      </Dialog>
      <Dialog open={dialog === 'end'} title={`Akhiri subtes ${activeSection?.name ?? ''}?`} onClose={() => setDialog(null)}
        footer={<><Button variant="secondary" data-autofocus onClick={() => setDialog(null)}>Kembali ke Soal</Button><Button variant="solid" loading={busy} onClick={endSection}>Ya, Akhiri</Button></>}>
        <Summary rows={[['Terjawab', `${answeredCount} dari ${questions.length}`], ['Belum dijawab', `${questions.length - answeredCount}`], ['Ragu-ragu', `${flaggedCount}`], ['Sisa waktu subtes', fmt.clock(remaining ?? 0)]]} />
        <p className="mt-3">Kamu tidak dapat kembali ke subtes ini, dan sisa waktunya tidak ditambahkan ke subtes berikutnya.</p>
      </Dialog>
      <Dialog open={help} title="Bantuan ujian" onClose={() => setHelp(false)}
        footer={<Button variant="secondary" data-autofocus onClick={() => setHelp(false)}>Tutup</Button>}>
        <ul className="space-y-1 text-sm">
          <li><kbd className="font-mono">A</kbd>–<kbd className="font-mono">E</kbd> memilih opsi</li>
          <li><kbd className="font-mono">N</kbd> / <kbd className="font-mono">→</kbd> soal berikutnya · <kbd className="font-mono">P</kbd> / <kbd className="font-mono">←</kbd> sebelumnya</li>
          <li><kbd className="font-mono">R</kbd> tandai ragu-ragu</li>
        </ul>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-[var(--color-primary-600)]" checked={shortcuts} onChange={(e) => { setShortcuts(e.target.checked); localStorage.setItem('cv-shortcuts', e.target.checked ? 'on' : 'off'); }} />
          Aktifkan pintasan huruf
        </label>
      </Dialog>

      <div aria-live={timerLevel === 'critical' ? 'assertive' : 'polite'} className="pointer-events-none fixed inset-x-0 top-20 z-40 flex justify-center px-4">
        {toast && <div className="pointer-events-auto rounded-md bg-neutral-900 px-4 py-3 text-sm font-medium text-white shadow-lg">{toast}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- subkomponen
function FullScreen({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-6 text-center">{children}</main>;
}

function Timer({ ms, level }: { ms: number | null; level: 'normal' | 'warning' | 'critical' }) {
  return (
    <div className={cx('flex h-10 items-center gap-1.5 rounded-md px-3 text-lg tabular sm:text-xl',
      level === 'critical' ? 'font-bold text-danger-700' : level === 'warning' ? 'font-bold text-secondary-700' : 'font-bold text-neutral-800')}
      role="timer" aria-label={`Sisa waktu ${ms === null ? 'sedang disinkronkan' : fmt.clock(ms)}`}>
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M10 2h4" strokeLinecap="round" /></svg>
      <span aria-hidden="true">{ms === null ? '—:—' : fmt.clock(ms)}</span>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, [string, string]> = {
    idle: ['', 'text-neutral-600'], saving: ['Menyimpan…', 'text-neutral-600'], saved: ['✓ Tersimpan', 'text-neutral-600'],
    retrying: ['⚠ Belum tersimpan — mencoba lagi', 'text-secondary-700'], offline: ['⊘ Offline', 'text-secondary-700'],
  };
  const [label, cls] = map[state];
  return <p className={cx('text-xs sm:text-sm', cls)} aria-live="polite">{state === 'saving' && <Spinner className="mr-1 inline h-3 w-3" />}{label}</p>;
}

function FlagIcon({ filled }: { filled: boolean }) {
  return <svg className="h-4 w-4" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 21V4m0 0h11l-2 4 2 4H5" strokeLinejoin="round" /></svg>;
}

function QuestionGrid({ questions, answers, index, onPick }: { questions: AttemptQuestionDto[]; answers: Record<string, Answer>; index: number; onPick: (i: number) => void }) {
  return (
    <ol className="grid grid-cols-6 gap-1.5 lg:grid-cols-5">
      {questions.map((x, i) => {
        const ans = answers[x.id];
        const answered = !!ans?.selectedOptionId;
        const current = i === index;
        const status = `${answered ? 'terjawab' : 'belum dijawab'}${ans?.isFlagged ? ', ragu-ragu' : ''}${current ? ', sedang dibuka' : ''}`;
        return (
          <li key={x.id}>
            <button onClick={() => onPick(i)} aria-label={`Soal ${x.number}, ${status}`} aria-current={current ? 'step' : undefined}
              className={cx('relative flex h-11 w-full items-center justify-center rounded-md text-sm font-medium tabular lg:h-10',
                answered ? 'bg-primary-600 text-white' : 'border border-neutral-500 bg-white text-neutral-800',
                current && 'ring-2 ring-neutral-900 ring-offset-2')}>
              {x.number}
              {ans?.isFlagged && <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-secondary-500 text-[9px] text-white" aria-hidden="true">⚑</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Legend() {
  return (
    <ul className="grid grid-cols-2 gap-1 text-xs text-neutral-600">
      <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-primary-600" aria-hidden="true" />Terjawab</li>
      <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-neutral-500" aria-hidden="true" />Belum dijawab</li>
      <li className="flex items-center gap-1.5"><span className="flex h-3 w-3 items-center justify-center rounded-full bg-secondary-500 text-[7px] text-white" aria-hidden="true">⚑</span>Ragu-ragu</li>
      <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm ring-2 ring-neutral-900" aria-hidden="true" />Sedang dibuka</li>
    </ul>
  );
}

function Summary({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
      {rows.map(([k, v]) => <div key={k} className="flex justify-between px-3 py-2"><dt>{k}</dt><dd className="font-medium tabular">{v}</dd></div>)}
    </dl>
  );
}

function Transition({ s, remaining, onStart }: { s: Extract<Screen, { kind: 'transition' }>; remaining: number | null; onStart: () => void }) {
  useEffect(() => { const t = setTimeout(onStart, 10000); return () => clearTimeout(t); }, [onStart]);
  return (
    <FullScreen>
      <p className="text-neutral-600">Subtes {s.nextIndex - 1} selesai.</p>
      <h1 className="mt-2 text-2xl font-bold">Berikutnya — Subtes {s.nextIndex} dari {s.total}</h1>
      <p className="mt-1 text-lg">{s.nextName}</p>
      <p className="text-neutral-600">{s.count} soal</p>
      <p className="mt-4 font-medium text-secondary-700">Waktu subtes ini sudah berjalan.</p>
      <p className="text-2xl font-bold tabular" role="timer">◷ {fmt.clock(remaining ?? 0)}</p>
      <Button variant="solid" size="lg" className="mt-6" onClick={onStart} autoFocus>Mulai Mengerjakan</Button>
    </FullScreen>
  );
}

