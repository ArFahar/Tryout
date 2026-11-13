'use client';
import { api } from './api';

/** Token sesi perangkat (BR-LIF-04) disimpan per tab; hanya dikirim lewat header X-Attempt-Session. */
const key = (attemptId: string) => `cv-attempt:${attemptId}`;

export function saveAttemptSession(attemptId: string, token: string) {
  try { sessionStorage.setItem(key(attemptId), token); } catch { /* mode privat */ }
}
export function readAttemptSession(attemptId: string) {
  try { return sessionStorage.getItem(key(attemptId)); } catch { return null; }
}

/** EP-ATT-02: memulai atau melanjutkan (sekaligus mengambil alih sesi di perangkat ini). */
export async function startOrResume(examId: string) {
  const r = await api<{ attempt: { id: string }; sessionToken: string }>('/attempts', { method: 'POST', body: { examId } });
  saveAttemptSession(r.attempt.id, r.sessionToken);
  return r.attempt.id;
}
