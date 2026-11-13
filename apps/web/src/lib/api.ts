'use client';
import type { ApiErrorBody, ErrorCode } from '@cogniverse/contracts';

export class ApiError extends Error {
  constructor(public status: number, public code: ErrorCode | 'NETWORK_ERROR', message: string,
    public details?: { field?: string; issue?: string; message: string }[]) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
async function refreshSession() {
  refreshing ??= fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'x-cv-client': 'web' }, credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

/** Pemanggil API: header X-CV-Client (TDD 5.13), pembaruan token otomatis saat SESSION_EXPIRED (5.2). */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; retry?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: opts.method ?? 'GET',
      headers: { 'content-type': 'application/json', 'x-cv-client': 'web', ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Tidak dapat terhubung. Periksa koneksi internetmu.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* abaikan */ }
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if (err?.code === 'SESSION_EXPIRED' && opts.retry !== false && (await refreshSession())) {
      return api<T>(path, { ...opts, retry: false });
    }
    throw new ApiError(res.status, err?.code ?? 'INTERNAL_ERROR', err?.message ?? 'Terjadi kesalahan di server. Coba lagi beberapa saat lagi.', err?.details);
  }
  return data as T;
}

export const fmt = {
  date(iso?: string | null) {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(iso));
  },
  dateTime(iso?: string | null) {
    if (!iso) return '—';
    const d = new Date(iso);
    const date = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(d);
    const time = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta', hour12: false }).format(d).replace(':', '.');
    return `${date} · ${time} WIB`;
  },
  duration(seconds: number) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    if (h && m) return `${h} j ${m} m`;
    if (h) return `${h} jam`;
    return `${m} menit`;
  },
  clock(ms: number) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  },
  pct(x: number) {
    return `${Math.round(x * 100)}%`;
  },
  rupiah(n: number) {
    return n === 0 ? 'Gratis' : `Rp${new Intl.NumberFormat('id-ID').format(n)}`;
  },
};
