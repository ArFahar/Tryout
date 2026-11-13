'use client';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, ButtonLink, Card, EmptyState, LoadingBlock, PageHeader, Segmented } from '@/components/ui';
import { PeriodCard, type PeriodExam, type Season } from '@/components/exam-card';
import { api } from '@/lib/api';
import { FILTERS, matchFilter, shortDate, type CatalogFilter } from '@/lib/catalog';

/** STU-15 Try Out Tersedia: ringkasan akses + periode dengan badge akses (EP-EXM-01 + EP-PKG-02). */
export default function AvailableTryouts() {
  const [data, setData] = useState<{ season: Season | null; data: PeriodExam[] } | null>(null);
  const [access, setAccess] = useState<any>(null);
  const [error, setError] = useState('');
  const [state, setState] = useState<CatalogFilter>('OPEN');
  const load = () => {
    setError('');
    Promise.all([api('/catalog/products'), api('/users/me/access')]).then(([c, a]) => { setData(c); setAccess(a); }).catch((e) => setError(e.message));
  };
  useEffect(load, []);
  const shown = useMemo(() => (data?.data ?? []).filter((e) => matchFilter(e, state)), [data, state]);
  return (
    <>
      <PageHeader title="Try out" description={data?.season?.name} actions={<ButtonLink href="/app/asesmen" variant="link">Asesmen saya</ButtonLink>} />
      {access && (
        <Card variant="muted" className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p>{access.seasonPass ? <>Lifetime aktif sampai <strong>{shortDate(access.seasonPass.validUntil)}</strong>.</>
            : access.credits.available > 0 ? <>Kamu punya <strong className="tabular">{access.credits.available}</strong> kredit.</>
              : 'Kamu belum punya kredit atau Lifetime.'}</p>
          {!access.seasonPass && <ButtonLink href="/paket" variant={access.credits.available > 0 ? 'link' : 'primary'} size="sm">{access.credits.available > 0 ? 'Tambah kredit' : 'Pilih paket'}</ButtonLink>}
        </Card>
      )}
      <Segmented className="mb-6" label="Status periode" value={state} onChange={setState} options={FILTERS} />
      {error ? <Alert tone="danger" action={<Button size="sm" variant="secondary" onClick={load}>Coba lagi</Button>}>{error}</Alert>
        : !data ? <LoadingBlock />
          : shown.length === 0 ? <EmptyState title="Belum ada try out untuk pilihan ini." />
            : <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{shown.map((e) => <div key={e.id} className="flex [&>a]:w-full"><PeriodCard exam={e} /></div>)}</div>}
    </>
  );
}
