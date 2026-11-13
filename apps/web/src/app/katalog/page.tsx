'use client';
import { useEffect, useMemo, useState } from 'react';
import { PublicShell } from '@/components/shells';
import { Alert, Button, ButtonLink, EmptyState, LoadingBlock, PageHeader, Segmented } from '@/components/ui';
import { PeriodCard, type PeriodExam, type Season } from '@/components/exam-card';
import { api } from '@/lib/api';
import { FILTERS, matchFilter, shortDate, type CatalogFilter } from '@/lib/catalog';

const daysTo = (d: string) => Math.ceil((Date.parse(`${d}T00:00:00+07:00`) - Date.now()) / 86400e3);

/** PUB-03 Try Out (katalog periode musim aktif). */
export default function Catalog() {
  const [data, setData] = useState<{ season: Season | null; data: PeriodExam[] } | null>(null);
  const [error, setError] = useState('');
  const [state, setState] = useState<CatalogFilter>('OPEN');
  const load = () => { setError(''); api('/catalog/products').then(setData).catch((e) => setError(e.message)); };
  useEffect(load, []);
  const shown = useMemo(() => (data?.data ?? []).filter((e) => matchFilter(e, state)), [data, state]);
  const counts = (f: CatalogFilter) => (data?.data ?? []).filter((e) => matchFilter(e, f)).length;
  const season = data?.season;
  return (
    <PublicShell>
      <div className="-mx-5 -my-10 bg-neutral-50 px-5 py-10 md:-my-14 md:py-14">
        <div className="mx-auto max-w-[1200px]">
          <PageHeader title={season?.name ?? 'Try out'}
            description={season?.examDate ? `SNBT ${shortDate(season.examDate)} · ${daysTo(season.examDate)} hari lagi. Setiap periode adalah satu Full Try Out lengkap.` : 'Setiap periode adalah satu Full Try Out lengkap.'}
            actions={<ButtonLink href="/paket" variant="link">Lihat paket</ButtonLink>} />
          <Segmented className="mb-8" label="Status periode" value={state} onChange={setState} options={FILTERS.map((f) => ({ ...f, count: data ? counts(f.value) : undefined }))} />
          {error ? <Alert tone="danger" title="Daftar try out gagal dimuat" action={<Button variant="secondary" size="sm" onClick={load}>Coba Lagi</Button>}>{error}</Alert>
            : !data ? <LoadingBlock />
              : shown.length === 0 ? <EmptyState title={state === 'OPEN' ? 'Periode berikutnya belum dibuka.' : 'Belum ada periode di sini.'}>Jadwalnya diumumkan di halaman ini.</EmptyState>
                : <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{shown.map((e) => <div key={e.id} className="flex [&>a]:w-full"><PeriodCard exam={e} /></div>)}</div>}
        </div>
      </div>
    </PublicShell>
  );
}
