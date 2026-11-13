'use client';
import { useState } from 'react';
import { PROVINCES } from '@cogniverse/contracts';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

export function ProfileForm({ submitLabel, onDone }: { submitLabel: string; onDone: () => void }) {
  const { me, reload } = useSession();
  const p = me?.studentProfile ?? {};
  const year = new Date().getFullYear();
  const [f, setF] = useState({
    studentStatus: p.studentStatus ?? '', schoolName: p.schoolName ?? '', graduationYear: String(p.graduationYear ?? year + 1),
    province: p.province ?? '', phone: p.phone ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setErrors({});
    try {
      await api('/users/me/student-profile', { method: 'PUT', body: { ...f, graduationYear: Number(f.graduationYear) } });
      await reload();
      onDone();
    } catch (err) {
      const ae = err as ApiError;
      if (ae.details) setErrors(Object.fromEntries(ae.details.map((d) => [d.field ?? '', d.message])));
      setError(ae.message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Status <span className="text-danger-700" aria-hidden="true">*</span></legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[['GRADE_12', 'Kelas 12'], ['GAP_YEAR', 'Gap year / alumni']].map(([v, l]) => (
            <label key={v} className={`flex h-12 cursor-pointer items-center gap-3 rounded-md border px-4 ${f.studentStatus === v ? 'border-[1.5px] border-primary-600 bg-primary-50' : 'border-neutral-500 bg-white'}`}>
              <input type="radio" name="status" value={v} checked={f.studentStatus === v} onChange={() => setF({ ...f, studentStatus: v })} className="h-5 w-5 accent-[var(--color-primary-600)]" />
              {l}
            </label>
          ))}
        </div>
        {errors.studentStatus && <p className="mt-1 text-sm text-danger-700">⚠ {errors.studentStatus}</p>}
      </fieldset>
      <Field label="Nama sekolah" required error={errors.schoolName}>{(a) => <Input {...a} value={f.schoolName} onChange={(e) => setF({ ...f, schoolName: e.target.value })} autoComplete="organization" />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tahun lulus SMA/sederajat" required error={errors.graduationYear}>{(a) => (
          <Select {...a} value={f.graduationYear} onChange={(e) => setF({ ...f, graduationYear: e.target.value })}>
            {Array.from({ length: 8 }, (_, i) => year + 2 - i).map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        )}</Field>
        <Field label="Provinsi" required error={errors.province}>{(a) => (
          <Select {...a} value={f.province} onChange={(e) => setF({ ...f, province: e.target.value })}>
            <option value="">Pilih provinsi</option>
            {PROVINCES.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
          </Select>
        )}</Field>
      </div>
      <Field label="Nomor WhatsApp" help="Opsional." error={errors.phone}>{(a) => <Input {...a} type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
      <Button type="submit" variant="solid" size="lg" loading={busy} className="w-full sm:w-auto">{submitLabel}</Button>
    </form>
  );
}
