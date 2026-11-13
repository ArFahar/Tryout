import type { PeriodExam, PeriodState } from '@/components/exam-card';

export type CatalogFilter = PeriodState;
/** Kontrol bersegmen status periode (PUB-03, STU-15). */
export const FILTERS: { value: CatalogFilter; label: string }[] = [
  { value: 'OPEN', label: 'Terbuka' }, { value: 'UPCOMING', label: 'Akan datang' }, { value: 'CLOSED', label: 'Selesai' },
];
export const matchFilter = (e: PeriodExam, f: CatalogFilter) => e.periodState === f;

export interface PackageItem {
  id: string; type: 'SINGLE' | 'BUNDLE' | 'LIFETIME'; name: string; priceAmount: number; tryoutCredits: number | null;
  pricePerPeriod: number | null; validUntil: string | null;
}
export interface PackagesResponse { season: { id: string; name: string; examDate: string | null; lifetimeEndsAt: string | null; creditsEndAt: string | null } | null; data: PackageItem[] }

/** Tanggal pendek WIB, mis. "8 Apr 2027". */
export const shortDate = (iso?: string | null) => (iso
  ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(iso)) : '—');
/** Tahun SNBT dari tanggal musim. */
export const seasonYear = (examDate?: string | null) => (examDate ? examDate.slice(0, 4) : '');
