'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Field, Input, Segmented, Select } from './ui';
import { api, ApiError } from '@/lib/api';

type Uni = { id: string; name: string; shortName: string | null; programCount: number };
type Prog = { id: string; name: string; reference: { score: number; source: string; year: number } | null };
type Choice = { universityId: string; universityName: string; programId: string; custom: boolean; customUniversity: string; customProgram: string };
const empty: Choice = { universityId: '', universityName: '', programId: '', custom: false, customUniversity: '', customProgram: '' };

/** Satu pilihan kampus + program studi dengan pencarian; "Lainnya" untuk isian bebas (FR-TGT-01). */
function TargetPicker({ label, value, onChange, optional }: { label: string; value: Choice; onChange: (c: Choice) => void; optional?: boolean }) {
  const [q, setQ] = useState(value.universityName);
  const [unis, setUnis] = useState<Uni[]>([]);
  const [progs, setProgs] = useState<Prog[]>([]);
  useEffect(() => {
    if (value.custom) return;
    const t = setTimeout(() => api(`/universities?q=${encodeURIComponent(q)}`).then((r) => setUnis(r.data)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q, value.custom]);
  useEffect(() => {
    if (!value.universityId) { setProgs([]); return; }
    api(`/universities/${value.universityId}/programs`).then((r) => setProgs(r.data)).catch(() => {});
  }, [value.universityId]);
  const prog = progs.find((p) => p.id === value.programId);
  return (
    <fieldset className="space-y-3 rounded-lg bg-neutral-50 p-4">
      <legend className="sr-only">{label}</legend>
      <p aria-hidden="true" className="text-callout font-semibold">{label}{optional && <span className="font-normal text-neutral-600"> (opsional)</span>}</p>
      {value.custom ? (
        <>
          <Field label="Nama kampus" required={!optional}>{(p) => <Input {...p} value={value.customUniversity} onChange={(e) => onChange({ ...value, customUniversity: e.target.value })} />}</Field>
          <Field label="Jurusan" required={!optional}>{(p) => <Input {...p} value={value.customProgram} onChange={(e) => onChange({ ...value, customProgram: e.target.value })} />}</Field>
          <button type="button" className="min-h-11 text-callout text-link hover:underline" onClick={() => onChange({ ...empty })}>Pilih dari daftar</button>
        </>
      ) : (
        <>
          <Field label="Kampus tujuan" required={!optional}>{(p) => (
            <>
              <Input {...p} placeholder="Cari kampus, mis. ITB" value={q} onChange={(e) => { setQ(e.target.value); onChange({ ...empty }); }} list={`${label}-unis`} />
              {!value.universityId && unis.length > 0 && q && (
                <ul className="mt-2 max-h-48 overflow-y-auto rounded-md bg-white" role="listbox" aria-label="Hasil pencarian kampus">
                  {unis.map((u) => (
                    <li key={u.id}>
                      <button type="button" role="option" aria-selected={false} className="block w-full px-3 py-2.5 text-left text-callout hover:bg-primary-50"
                        onClick={() => { setQ(u.name); onChange({ ...empty, universityId: u.id, universityName: u.name }); }}>
                        {u.name}{u.shortName && <span className="text-neutral-600"> · {u.shortName}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}</Field>
          {value.universityId && (
            <Field label="Jurusan" required={!optional}>{(p) => (
              <Select {...p} value={value.programId} onChange={(e) => onChange({ ...value, programId: e.target.value })}>
                <option value="">Pilih program studi</option>
                {progs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            )}</Field>
          )}
          {value.programId && (
            <p className="text-footnote text-neutral-600">
              {prog?.reference
                ? <>Acuan {prog.reference.source}, {prog.reference.year}: {prog.reference.score}. Skala sumber berbeda dengan skor Cogniverse.</>
                : 'Data acuan untuk program ini belum tersedia.'}
            </p>
          )}
          <button type="button" className="min-h-11 text-callout text-link hover:underline" onClick={() => onChange({ ...empty, custom: true })}>Kampus atau jurusan tidak ada? Isi sendiri</button>
        </>
      )}
    </fieldset>
  );
}

/** STU-01 langkah 2 dan ubah target di STU-13 (FR-TGT-01/02, FR-RMP-07). */
export function TargetForm({ submitLabel, onDone, showMinutes = true }: { submitLabel: string; onDone: () => void; showMinutes?: boolean }) {
  const [t1, setT1] = useState<Choice>({ ...empty });
  const [t2, setT2] = useState<Choice>({ ...empty });
  const [showSecond, setShowSecond] = useState(false);
  const [score, setScore] = useState('');
  const [minutes, setMinutes] = useState<'30' | '60' | '90' | '120'>('60');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api('/users/me/targets').then((r) => {
      const map = (x: any): Choice => x.isCustom ? { ...empty, custom: true, customUniversity: x.university, customProgram: x.program }
        : { ...empty, universityId: '', universityName: x.university, programId: x.studyProgramId };
      const a = r.targets.find((x: any) => x.priority === 1); const b = r.targets.find((x: any) => x.priority === 2);
      if (a) { setT1(map(a)); if (a.personalTargetScore != null) setScore(String(a.personalTargetScore)); }
      if (b) { setT2(map(b)); setShowSecond(true); }
    }).catch(() => {});
    api('/users/me').then((r) => { const m = (r.studentProfile ?? r.user?.studentProfile)?.dailyStudyMinutes; if (m) setMinutes(String(m) as any); }).catch(() => {});
  }, []);

  // Target yang dimuat dari server hanya punya nama kampus; cari ulang id kampusnya agar daftar jurusan bisa tampil
  useEffect(() => {
    for (const [c, set] of [[t1, setT1], [t2, setT2]] as const) {
      if (!c.custom && c.programId && !c.universityId && c.universityName) {
        api(`/universities?q=${encodeURIComponent(c.universityName)}`).then((r) => {
          const u = r.data.find((x: Uni) => x.name === c.universityName);
          if (u) (set as any)((v: Choice) => ({ ...v, universityId: u.id }));
        }).catch(() => {});
      }
    }
  }, [t1, t2]);

  const toBody = (c: Choice, priority: 1 | 2) => c.custom
    ? { priority, customUniversity: c.customUniversity.trim(), customProgram: c.customProgram.trim() }
    : { priority, studyProgramId: c.programId };
  const filled = (c: Choice) => (c.custom ? c.customUniversity.trim().length >= 2 && c.customProgram.trim().length >= 2 : !!c.programId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const targets: any[] = [{ ...toBody(t1, 1), personalTargetScore: score === '' ? null : Number(score) }];
      if (showSecond && filled(t2)) targets.push(toBody(t2, 2));
      await api('/users/me/targets', { method: 'PUT', body: { targets } });
      if (showMinutes) await api('/users/me/study-preferences', { method: 'PUT', body: { dailyMinutes: Number(minutes) } });
      onDone();
    } catch (err) { setError(err as ApiError); setBusy(false); }
  }

  const scoreErr = score !== '' && (Number(score) % 10 !== 0 || Number(score) < 0 || Number(score) > 1000) ? 'Gunakan kelipatan 10 antara 0 dan 1000, misalnya 650.' : undefined;
  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && <Alert tone="danger">{error.details?.map((d) => d.message).join(' ') || error.message}</Alert>}
      <TargetPicker label="Pilihan pertama" value={t1} onChange={setT1} />
      {showSecond ? <TargetPicker label="Pilihan kedua" value={t2} onChange={setT2} optional />
        : <button type="button" className="min-h-11 text-callout text-link hover:underline" onClick={() => setShowSecond(true)}>+ Tambah pilihan kedua</button>}
      <Field label="Target skor (skala Cogniverse 0–1000)" help="Opsional. Kamu bisa mengisinya nanti." error={scoreErr}>{(p) => (
        <Input {...p} type="number" inputMode="numeric" step={10} min={0} max={1000} placeholder="650" value={score} onChange={(e) => setScore(e.target.value)} className="max-w-40" />
      )}</Field>
      {showMinutes && (
        <div>
          <p className="mb-2 text-callout font-semibold">Waktu belajar per hari</p>
          <Segmented label="Waktu belajar per hari" value={minutes} onChange={setMinutes}
            options={[{ value: '30', label: '30 mnt' }, { value: '60', label: '60 mnt' }, { value: '90', label: '90 mnt' }, { value: '120', label: '120 mnt' }]} />
        </div>
      )}
      <Button type="submit" size="lg" loading={busy} disabled={!filled(t1) || !!scoreErr} className="w-full sm:w-auto">{submitLabel}</Button>
    </form>
  );
}
