// Uji asap timer server: rekonsiliasi subtes PER_SECTION dan auto-submit oleh sweeper (TDD 6.3.2, 6.3.4).
// Tenggat dimundurkan langsung di database agar tidak perlu menunggu durasi sebenarnya.
import pg from 'pg';
const BASE = 'http://localhost:4000/api/v1';
const db = new pg.Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:54329/cogniverse' });
await db.connect();
let failures = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'OK  ' : 'FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) failures++; };
const jar = new Map();
async function call(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-cv-client': 'web', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (v) jar.set(k, v); else jar.delete(k); }
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
}
// v3.0: siswa contoh memakai akses paket (membeli 1x lewat simulator bila belum punya akses), lalu memilih
// periode terbuka yang belum pernah dikerjakan. Registrasi akun baru dihindari karena dibatasi 5/jam per IP.
await call('POST', '/auth/login', { email: 'siswa@cogniverse.test', password: 'Cogniverse#2026' });
await call('PUT', '/users/me/targets', { targets: [{ priority: 1, customUniversity: 'Kampus Uji', customProgram: 'Jurusan Uji', personalTargetScore: 650 }] });
const open = (await call('GET', '/catalog/products')).body.data.filter((e) => e.periodState === 'OPEN');
const mini = open.find((e) => e.access?.kind !== 'ENTITLED' || e.access.state === 'READY');
if (mini.access?.kind === 'NONE') {
  const single = (await call('GET', '/packages')).body.data.find((p) => p.type === 'SINGLE');
  const order = await call('POST', '/orders', { productId: single.id });
  await call('POST', `/orders/${order.body.order.id}/dev-pay`, { outcome: 'SETTLED' });
}
if (mini.access?.kind !== 'ENTITLED') await call('POST', `/exams/${mini.id}/redeem`, { useCredit: true });
const start = await call('POST', '/attempts', { examId: mini.id });
check('mulai Full Try Out (kredit paket)', [200, 201].includes(start.status), start.body?.error?.code);
const id = start.body.attempt.id;
const H = { 'x-attempt-session': start.body.sessionToken };
const st = await call('GET', `/attempts/${id}`, undefined, H);
const q1 = st.body.questions[0];
await call('PUT', `/attempts/${id}/answers/${q1.id}`, { clientSeq: 1, selectedOptionId: q1.options[1].id, isFlagged: false, timeSpentMs: 5000 }, H);

// Subtes 1 berakhir 30 detik lalu -> subtes 2 harus aktif dengan tenggat = tenggat subtes 1 + durasinya (BR-TMO-05)
await db.query(`UPDATE attempt_sections SET started_at = now() - interval '270 seconds', deadline_at = now() - interval '30 seconds' WHERE attempt_id = $1 AND position = 1`, [id]);
await db.query(`UPDATE exam_attempts SET started_at = now() - interval '270 seconds', expires_at = now() + interval '210 seconds' WHERE id = $1`, [id]);
const st2 = await call('GET', `/attempts/${id}`, undefined, H);
const [s1, s2] = st2.body.sections;
check('subtes 1 berakhir TIMEOUT, subtes 2 aktif', s1.status === 'ENDED' && s2.status === 'ACTIVE');
const gap = new Date(s2.startedAt).getTime() - new Date(s1.deadlineAt).getTime();
check('subtes 2 dimulai tepat pada tenggat subtes 1', gap === 0, `selisih ${gap} ms`);
const late = await call('PUT', `/attempts/${id}/answers/${q1.id}`, { clientSeq: 2, selectedOptionId: q1.options[2].id, isFlagged: false, timeSpentMs: 1 }, H);
check('jawaban subtes 1 setelah tenggat + grace ditolak', ['ATTEMPT_EXPIRED', 'SECTION_NOT_ACTIVE'].includes(late.body?.error?.code), late.body?.error?.code);

// Seluruh waktu habis -> sweeper mengumpulkan otomatis
await db.query(`UPDATE attempt_sections SET started_at = now() - interval '100 seconds', deadline_at = now() - interval '20 seconds' WHERE attempt_id = $1 AND position = 2`, [id]);
await db.query(`UPDATE exam_attempts SET expires_at = now() - interval '20 seconds' WHERE id = $1`, [id]);
let row;
for (let i = 0; i < 25; i++) {
  row = (await db.query('SELECT status, submission_type, submitted_at = expires_at AS at_deadline FROM exam_attempts WHERE id = $1', [id])).rows[0];
  if (row.status === 'SCORED') break;
  await new Promise((r) => setTimeout(r, 1000));
}
check('sweeper mengumpulkan otomatis (AUTO_TIMEOUT) dan menilai', row.status === 'SCORED' && row.submission_type === 'AUTO_TIMEOUT', JSON.stringify(row));
check('submitted_at = expires_at (TDD 6.3.4)', row.at_deadline === true);
const res = await call('GET', `/attempts/${id}/result`);
check('jawaban sebelum tenggat ikut dinilai', res.body.result.correctCount + res.body.result.incorrectCount === 1, `benar ${res.body.result.correctCount}, salah ${res.body.result.incorrectCount}`);

await db.end();
console.log(failures ? `\n${failures} pemeriksaan GAGAL` : '\nSemua pemeriksaan lolos');
process.exit(failures ? 1 : 0);
