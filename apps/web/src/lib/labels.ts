/** Label status berbahasa Indonesia (UI/UX 9.3). */
export const STATE_LABEL: Record<string, string> = {
  READY: 'Siap dikerjakan', IN_PROGRESS: 'Sedang berlangsung', COMPLETED: 'Selesai', EXPIRED: 'Kedaluwarsa', REVOKED: 'Dicabut',
  NEEDS_SESSION: 'Perlu pilih sesi', SCHEDULED: 'Terjadwal',
};

export const EXAM_STATUS: Record<string, [string, any]> = {
  DRAFT: ['Draf', 'neutral'], PUBLISHED: ['Terbit', 'success'], UNPUBLISHED: ['Ditarik', 'warning'], ARCHIVED: ['Diarsipkan', 'neutral'],
};

/** Klasifikasi topik (UI/UX 6.7.7). */
export const CLASS_LABEL: Record<string, [string, 'danger' | 'neutral' | 'success']> = {
  NEEDS_IMPROVEMENT: ['Perlu ditingkatkan', 'danger'], ADEQUATE: ['Cukup', 'neutral'], STRONG: ['Kuat', 'success'],
};
