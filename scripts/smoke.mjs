// Uji asap API v3.0 end-to-end (TDD 8.2 TC-PKG, TC-REF, TC-TGT, TC-RMP + alur ujian):
// login → target → paket + pembayaran (simulator) → tukar kredit → ujian → hasil → laporan PI → roadmap & plan harian → referral.
// Pemakaian: node scripts/smoke.mjs   (DB pengembangan segar: node scripts/db.mjs reset)
import pg from 'pg';
const BASE = process.argv[2] ?? 'http://localhost:4000/api/v1';
const db = new pg.Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:54329/cogniverse' });
await db.connect();
let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
}
function client() {
  const jar = new Map();
  return async function call(method, path, body, headers = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-cv-client': 'web', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(';'); const [k, v] = kv.split('=');
      if (v) jar.set(k, v); else jar.delete(k);
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}
const PROFILE = { studentStatus: 'GRADE_12', schoolName: 'SMA Uji Asap', graduationYear: 2027, province: 'Jawa Barat' };

// ---------------------------------------------------------------- akun & target
const s = client();
const login = await s('POST', '/auth/login', { email: 'siswa@cogniverse.test', password: 'Cogniverse#2026' });
check('login siswa', login.status === 200, login.body?.user?.fullName);
const csrf = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
check('POST tanpa X-CV-Client ditolak (CSRF)', csrf.status === 403);

const pk = await s('GET', '/packages');
const byType = Object.fromEntries((pk.body.data ?? []).map((p) => [p.type, p]));
check('tiga paket dengan harga [Established]', byType.SINGLE?.priceAmount === 35000 && byType.BUNDLE?.priceAmount === 79000 && byType.LIFETIME?.priceAmount === 150000,
  (pk.body.data ?? []).map((p) => `${p.type} ${p.priceAmount}`).join(', '));
check('Bundle 4 kredit, harga per periode dihitung', byType.BUNDLE?.tryoutCredits === 4 && byType.BUNDLE?.pricePerPeriod === 19750);
check('Lifetime berakhir H-7 SNBT', !!pk.body.season?.lifetimeEndsAt && byType.LIFETIME?.validUntil === pk.body.season.lifetimeEndsAt, pk.body.season?.lifetimeEndsAt);

const cat = await s('GET', '/catalog/products');
const periods = cat.body.data ?? [];
check('katalog hanya Full Try Out periode', periods.length === 3 && periods.every((e) => e.examType === 'FULL_TRYOUT' && e.reportTier === 'COMPLETE'),
  periods.map((e) => `P${e.periodNumber}:${e.periodState}`).join(' '));
check('akses awal: belum punya kredit', periods.every((e) => e.access?.kind === 'NONE'));
const [P1, P2, P3] = periods;
const claim = await s('POST', `/exams/${P1.id}/claim`);
check('klaim gratis sudah dihapus (404)', claim.status === 404);

const noTarget = await s('POST', '/orders', { productId: byType.BUNDLE.id });
check('order sebelum target ditolak (TC-TGT-03)', noTarget.body?.error?.code === 'TARGET_REQUIRED', noTarget.body?.error?.code);
const unis = await s('GET', '/universities?q=Bandung');
const itb = unis.body.data?.[0];
const progs = await s('GET', `/universities/${itb.id}/programs`);
const ti = progs.body.data.find((p) => p.name === 'Teknik Informatika');
check('data kampus tanpa skor acuan (OQ-20)', !!ti && ti.reference === null);
const bad = await s('PUT', '/users/me/targets', { targets: [{ priority: 1, studyProgramId: ti.id, personalTargetScore: 655 }] });
check('target bukan kelipatan 10 ditolak (TC-TGT-02)', bad.status === 400);
const tg = await s('PUT', '/users/me/targets', { targets: [{ priority: 1, studyProgramId: ti.id, personalTargetScore: 650 }, { priority: 2, customUniversity: 'Politeknik Uji', customProgram: 'Teknik Komputer' }] });
check('simpan target', tg.status === 200 && tg.body.targets.length === 2 && tg.body.targets[0].personalTargetScore === 650);
const me = await s('GET', '/users/me');
check('profil menandai target terisi', me.body.user?.hasTarget === true);

// ---------------------------------------------------------------- paket & pembayaran
const ord = await s('POST', '/orders', { productId: byType.BUNDLE.id });
check('order Bundle dibuat', ord.status === 201 && ord.body.order.status === 'PENDING' && ord.body.order.totalAmount === 79000 && ord.body.payment?.simulator === true);
const ordAgain = await s('POST', '/orders', { productId: byType.BUNDLE.id });
check('order PENDING yang sama dikembalikan (FR-PAY-12)', ordAgain.status === 200 && ordAgain.body.order.id === ord.body.order.id);
const paid = await s('POST', `/orders/${ord.body.order.id}/dev-pay`, { outcome: 'SETTLED' });
check('bayar (simulator) → PAID + 4 kredit', paid.body.order?.status === 'PAID' && paid.body.grant?.kind === 'CREDITS' && paid.body.grant?.creditsTotal === 4);
await s('POST', `/orders/${ord.body.order.id}/dev-pay`, { outcome: 'SETTLED' });
const grants = await db.query('SELECT count(*)::int n FROM package_grants g JOIN order_items i ON i.id = g.order_item_id WHERE i.order_id = $1', [ord.body.order.id]);
check('pembayaran berulang idempotent (TC-PKG-01)', grants.rows[0].n === 1);
let acc = await s('GET', '/users/me/access');
check('saldo 4 kredit', acc.body.credits?.available === 4);

const r0 = await s('POST', `/exams/${P1.id}/redeem`, {});
check('tukar tanpa konfirmasi → 409 (TC-PKG-03)', r0.body?.error?.code === 'CREDIT_CONFIRMATION_REQUIRED');
const r1 = await s('POST', `/exams/${P1.id}/redeem`, { useCredit: true });
check('tukar 1 kredit → entitlement', r1.status === 201 && r1.body.creditsRemaining === 3);
const [ra, rb] = await Promise.all([s('POST', `/exams/${P2.id}/redeem`, { useCredit: true }), s('POST', `/exams/${P2.id}/redeem`, { useCredit: true })]);
acc = await s('GET', '/users/me/access');
check('tukar bersamaan memakai 1 kredit (TC-PKG-02)', ra.body.entitlement?.id === rb.body.entitlement?.id && acc.body.credits.available === 2, `${ra.status}/${rb.status}, sisa ${acc.body.credits.available}`);
const r3 = await s('POST', `/exams/${P3.id}/redeem`, { useCredit: true });
check('periode yang belum dibuka ditolak', r3.body?.error?.code === 'EXAM_NOT_AVAILABLE');

const lt = await s('POST', '/orders', { productId: byType.LIFETIME.id });
await s('POST', `/orders/${lt.body.order.id}/dev-pay`, { outcome: 'SETTLED' });
acc = await s('GET', '/users/me/access');
check('Lifetime → akses musim', !!acc.body.seasonPass && acc.body.seasonPass.validUntil === pk.body.season.lifetimeEndsAt);
const lt2 = await s('POST', '/orders', { productId: byType.LIFETIME.id });
check('Lifetime kedua ditolak (TC-PKG-05)', lt2.body?.error?.code === 'SEASON_PASS_EXISTS');

// ---------------------------------------------------------------- ujian
const startA = await s('POST', '/attempts', { examId: P1.id });
check('mulai Full Try Out periode 1', [200, 201].includes(startA.status), startA.body?.error?.code);
const attemptId = startA.body.attempt.id;
const H = { 'x-attempt-session': startA.body.sessionToken };
let seq = 1;
let st = await s('GET', `/attempts/${attemptId}`, undefined, H);
check('PER_SECTION: soal subtes aktif saja', st.body.questions.every((q) => q.sectionId === st.body.sections[0].id));
check('tidak ada kunci/pembahasan dalam respons ujian', !/isCorrect|is_correct|explanation/i.test(JSON.stringify(st.body)));
// Jawab subtes demi subtes: opsi B untuk soal pertama tiap subtes, lainnya kosong
for (let i = 0; i < st.body.sections.length; i++) {
  const q = st.body.questions[0];
  await s('PUT', `/attempts/${attemptId}/answers/${q.id}`, { clientSeq: seq++, selectedOptionId: q.options[1].id, isFlagged: false, timeSpentMs: 9000 }, H);
  if (i === 0) {
    await s('PUT', `/attempts/${attemptId}/answers/${q.id}`, { clientSeq: seq++, selectedOptionId: q.options[2].id, isFlagged: false, timeSpentMs: 12000 }, H);
  }
  if (i < st.body.sections.length - 1) {
    await s('POST', `/attempts/${attemptId}/sections/${st.body.sections[i].id}/end`, undefined, H);
    st = await s('GET', `/attempts/${attemptId}`, undefined, H);
  }
}
const sub = await s('POST', `/attempts/${attemptId}/submit`);
check('submit', sub.body?.attempt?.status === 'SCORED', sub.body?.attempt?.status);
const changes = await db.query('SELECT max(answer_change_count)::int m FROM attempt_answers WHERE attempt_id = $1', [attemptId]);
check('perubahan jawaban tercatat (FR-ENG-17)', changes.rows[0].m === 1);

const res = await s('GET', `/attempts/${attemptId}/result`);
check('hasil', res.status === 200, `skor ${res.body.result?.totalScore}`);
const rep = await s('GET', `/attempts/${attemptId}/report`);
check('laporan satu tingkat (COMPLETE, tanpa bagian terkunci)', rep.body.reportTier === 'COMPLETE' && rep.body.lockedSections.length === 0 && Array.isArray(rep.body.behavior?.sectionTime));
check('bahasa insight bebas kata terlarang', !/lemah|bodoh|tidak berbakat|kurang cerdas|gagal/i.test(JSON.stringify(rep.body.insights) + JSON.stringify(rep.body.recommendations)));
const ev = rep.body.insights.find((i) => i.hasEvidence);
if (ev) {
  const e = await s('GET', `/attempts/${attemptId}/insights/${ev.id}`);
  check('bukti insight tanpa kunci jawaban', e.status === 200 && !/correctKey|isCorrect|optionKey/i.test(JSON.stringify(e.body)));
}

// ---------------------------------------------------------------- roadmap & plan harian
const rm = await s('GET', '/users/me/roadmap');
const plan = rm.body.plan;
check('roadmap dibangun setelah analisis (TC-RMP-01)', !!plan && plan.phases.length >= 1 && plan.examDateKnown && plan.targetScore === 650,
  plan ? `${plan.phases.length} minggu, ${plan.daysToExam} hari ke SNBT` : 'tidak ada');
check('minggu 1 memprioritaskan topik perlu ditingkatkan', plan?.phases[0].topics.every((t) => ['NEEDS_IMPROVEMENT', null].includes(t.classification) || plan.phases[0].topics[0].classification === 'NEEDS_IMPROVEMENT'));
check('selisih > 150 → 3 topik per minggu (BR-RMP-02)', (650 - plan.currentScore) > 150 ? plan.phases[0].topics.length === 3 : plan.phases[0].topics.length === 2, `skor ${plan.currentScore}`);
const pl = await s('GET', '/users/me/plan');
check('plan 7 hari, menit per hari ≤ 60 (BR-RMP-03)', pl.body.days.length === 7 && pl.body.days.every((d) => d.totalMinutes <= 60),
  pl.body.days.map((d) => d.totalMinutes).join('/'));
const firstItem = pl.body.days.flatMap((d) => d.items)[0];
check('tugas memiliki tautan pembahasan/panduan', !!firstItem?.link, firstItem?.title);
const done = await s('PATCH', `/users/me/plan/items/${firstItem.id}`, { done: true });
check('centang tugas', done.body.item?.status === 'DONE');
const before = JSON.stringify(rm.body.plan.phases);
const same = await s('PUT', '/users/me/study-preferences', { dailyMinutes: 60 });
check('roadmap deterministik untuk masukan sama (TC-RMP-02)', JSON.stringify(same.body.plan.phases.map(({ progress, ...p }) => p)) === JSON.stringify(JSON.parse(before).map(({ progress, ...p }) => p)));
const thirty = await s('PUT', '/users/me/study-preferences', { dailyMinutes: 30 });
const pl30 = await s('GET', '/users/me/plan');
const kept = await db.query(`SELECT count(*)::int n FROM study_plan_items WHERE id = $1 AND status = 'DONE'`, [firstItem.id]);
check('ubah waktu belajar → plan baru, tugas DONE lama tetap (TC-RMP-03)', thirty.body.plan.dailyMinutes === 30 && pl30.body.days.every((d) => d.totalMinutes <= 30) && kept.rows[0].n === 1);
const topicId = plan.phases[0].topics[0].topicId;
const guide = await s('GET', `/topics/${topicId}/guide`);
check('panduan materi topik prioritas', guide.status === 200 && !!guide.body.topic, guide.body.guide ? 'ada panduan' : 'belum ada panduan');
const tgt = await s('GET', '/users/me/targets');
check('jarak ke target pribadi', tgt.body.gap === 650 - tgt.body.latest.score, `skor ${tgt.body.latest?.score}, kurang ${tgt.body.gap}`);
const rv = await s('GET', `/attempts/${attemptId}/review?topicId=${topicId}`);
check('pembahasan per topik roadmap', rv.status === 200 && rv.body.data.every((d) => d.topicId === topicId));

// ---------------------------------------------------------------- referral
const ref = await s('GET', '/users/me/referral');
check('kode referral siswa', /^[A-Z0-9]{6,10}$/.test(ref.body.code ?? '') && ref.body.threshold === 3 && ref.body.percentOff === 20, ref.body.code);
const okCode = await client()('GET', `/referral-codes/${ref.body.code}`);
check('cek kode publik tanpa identitas pemilik', okCode.body.valid === true && Object.keys(okCode.body).length === 1);
async function friend(n, buy) {
  const f = client();
  const email = `teman${n}-${Date.now()}@cogniverse.test`;
  const reg = await f('POST', '/auth/register', { fullName: `Teman ${n}`, email, password: 'Cogniverse#2026', acceptedTermsVersion: '2026-11', acceptedPrivacyVersion: '2026-11', referralCode: n === 0 ? 'ZZZZZZ' : ref.body.code });
  await db.query('UPDATE users SET email_verified_at = now() WHERE email = $1', [email]);
  await f('PUT', '/users/me/student-profile', PROFILE);
  await f('PUT', '/users/me/targets', { targets: [{ priority: 1, studyProgramId: ti.id }] });
  if (buy) {
    const o = await f('POST', '/orders', { productId: byType.SINGLE.id });
    await f('POST', `/orders/${o.body.order.id}/dev-pay`, { outcome: 'SETTLED' });
  }
  return reg.status;
}
check('registrasi dengan kode tidak valid tetap berhasil (TC-REF-01)', (await friend(0, true)) === 201);
await friend(1, true); await friend(2, true); await friend(3, false);
let rs = await s('GET', '/users/me/referral');
check('3 terdaftar, 2 membeli → belum ada voucher (TC-REF-02)', rs.body.registered === 3 && rs.body.qualified === 2 && rs.body.vouchers.length === 0, `${rs.body.registered}/${rs.body.qualified}`);
await friend(4, true);
rs = await s('GET', '/users/me/referral');
const voucher = rs.body.vouchers[0];
check('pembeli ke-3 → voucher 20%', rs.body.qualified === 3 && rs.body.vouchers.length === 1 && voucher.percentOff === 20 && voucher.status === 'AVAILABLE');
check('ringkasan referral tanpa identitas teman (TC-REF-04)', !/email|fullName|Teman/i.test(JSON.stringify(rs.body)));
const vo = await s('POST', '/orders', { productId: byType.SINGLE.id, voucherId: voucher.id });
check('voucher dipakai di checkout: Rp35.000 − 20%', vo.body.order?.discountAmount === 7000 && vo.body.order?.totalAmount === 28000);
const vo2 = await s('POST', '/orders', { productId: byType.BUNDLE.id, voucherId: voucher.id });
check('voucher terkunci saat order PENDING', vo2.body?.error?.code === 'VOUCHER_NOT_AVAILABLE');
await db.query(`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = $1`, [vo.body.order.id]);
await fetch(BASE.replace('/api/v1', '') + '/api/v1/packages'); // pemicu ringan; sweeper berjalan tiap 60 detik
await new Promise((r) => setTimeout(r, 61_000));
const vs = await s('GET', '/users/me/vouchers');
check('order kedaluwarsa → voucher kembali tersedia (TC-REF-03)', vs.body.data[0]?.status === 'AVAILABLE', vs.body.data[0]?.status);

// ---------------------------------------------------------------- riwayat & progres
const hist = await s('GET', '/users/me/attempts');
check('riwayat ujian', hist.body.data.length >= 1);
const orders = await s('GET', '/users/me/orders');
check('riwayat transaksi', orders.body.data.length >= 3, orders.body.data.map((o) => `${o.productName}:${o.status}`).join(', '));

await db.end();
console.log(failures ? `\n${failures} pemeriksaan GAGAL` : '\nSemua pemeriksaan lolos');
process.exit(failures ? 1 : 0);
