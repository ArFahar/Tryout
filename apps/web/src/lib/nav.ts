/** Hanya izinkan tujuan internal agar parameter ?lanjut= tidak menjadi open redirect. */
export function safeNext(v: string | null) {
  return v && v.startsWith('/') && !v.startsWith('//') ? v : null;
}
