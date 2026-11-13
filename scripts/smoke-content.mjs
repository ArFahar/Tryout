// Uji asap alur konten: kontributor menulis soal -> editor review -> admin menyusun dan menerbitkan ujian -> siswa melihatnya.
const BASE = process.argv[2] ?? 'http://localhost:4000/api/v1';
const PW = 'Cogniverse#2026';
let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
}
function client() {
  const jar = new Map();
  return async function call(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-cv-client': 'web', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (v) jar.set(k, v); else jar.delete(k); }
    const t = await res.text();
    return { status: res.status, body: t ? JSON.parse(t) : null };
  };
}
const tutor = client(), editor = client(), admin = client(), siswa = client();
for (const [c, e] of [[tutor, 'tutor'], [editor, 'editor'], [admin, 'admin'], [siswa, 'siswa']]) {
  const r = await c('POST', '/auth/login', { email: `${e}@cogniverse.test`, password: PW });
  check(`login ${e}`, r.status === 200);
}

const subj = (await tutor('GET', '/subjects')).body.data.find((s) => s.code === 'PK');
const topic = subj.topics.find((t) => t.code === 'PK-GEO');
const created = await tutor('POST', '/questions', { stemHtml: '', explanationHtml: '', options: [] });
check('kontributor membuat draf', created.status === 201);
const vid = created.body.version.id;
const qid = created.body.question.id;

const incomplete = await tutor('POST', `/question-versions/${vid}/submit`);
check('pengajuan draf kosong ditolak (BR-QV-08)', incomplete.status === 422 && incomplete.body.error.details.length >= 5, `${incomplete.body.error?.details?.length} masalah`);

const content = {
  subjectId: subj.id, topicId: topic.id, difficulty: 'EASY', cognitiveLevel: 'APPLY',
  stemHtml: '<p>Keliling persegi dengan panjang sisi \\(7\\) cm adalah …</p><script>alert(1)</script>',
  explanationHtml: '<p>Keliling \\(= 4 \\times 7 = 28\\) cm.</p>',
  options: [['A', '14 cm'], ['B', '21 cm'], ['C', '28 cm'], ['D', '49 cm']].map(([key, t]) => ({ key, contentHtml: `<p>${t}</p>`, isCorrect: key === 'C' })),
};
const saved = await tutor('PUT', `/question-versions/${vid}`, content);
check('simpan isi versi', saved.status === 200);
check('HTML disanitasi server (AD-10)', !saved.body.version.stemHtml.includes('<script'));
const submitted = await tutor('POST', `/question-versions/${vid}/submit`);
check('ajukan review', submitted.status === 200 && submitted.body.version.status === 'IN_REVIEW');
const locked = await tutor('PUT', `/question-versions/${vid}`, content);
check('isi terkunci selama review', locked.body?.error?.code === 'VERSION_NOT_EDITABLE');

const self = await tutor('POST', `/question-versions/${vid}/reviews`, { decision: 'APPROVED', expectedStatus: 'IN_REVIEW' });
check('kontributor tidak dapat me-review', self.status === 403);
const queue = await editor('GET', '/reviews/queue');
check('soal muncul di antrean editor', queue.body.data.some((x) => x.versionId === vid));
const noNotes = await editor('POST', `/question-versions/${vid}/reviews`, { decision: 'CHANGES_REQUESTED', expectedStatus: 'IN_REVIEW' });
check('minta revisi tanpa catatan ditolak', noNotes.status === 400);
const changes = await editor('POST', `/question-versions/${vid}/reviews`, { decision: 'CHANGES_REQUESTED', notes: 'Tambahkan satuan pada soal.', expectedStatus: 'IN_REVIEW' });
check('editor meminta revisi', changes.status === 201);
await tutor('PUT', `/question-versions/${vid}`, { ...content, stemHtml: '<p>Keliling persegi dengan panjang sisi \\(7\\) cm adalah … (dalam cm)</p>' });
await tutor('POST', `/question-versions/${vid}/submit`);
const approve = await editor('POST', `/question-versions/${vid}/reviews`, { decision: 'APPROVED', expectedStatus: 'IN_REVIEW' });
check('editor menyetujui revisi', approve.status === 201);
const stale = await editor('POST', `/question-versions/${vid}/reviews`, { decision: 'REJECTED', notes: 'x', expectedStatus: 'IN_REVIEW' });
check('keputusan kedua ditolak (VERSION_STATUS_CHANGED)', stale.body?.error?.code === 'VERSION_STATUS_CHANGED');
const v2 = await tutor('POST', `/questions/${qid}/versions`, {});
check('versi baru dari versi disetujui', v2.status === 201 && v2.body.version.versionNumber === 2);
const v3 = await tutor('POST', `/questions/${qid}/versions`, {});
check('hanya satu versi terbuka (FR-QV-01)', v3.body?.error?.code === 'OPEN_VERSION_EXISTS');

// Exam builder
const exam = await admin('POST', '/admin/exams', { title: 'Latihan Geometri Singkat', description: 'Uji asap', examType: 'FULL_TRYOUT', deliveryMode: 'ON_DEMAND', timingMode: 'TOTAL' });
check('admin membuat exam', exam.status === 201);
const eid = exam.body.exam.id;
const dry = await admin('POST', `/admin/exams/${eid}/publish`, { dryRun: true });
check('dry run menampilkan masalah', dry.body.issues.length >= 3, dry.body.issues.map((i) => i.issue).join(','));
const detail = await admin('GET', `/admin/exams/${eid}`);
const sid = detail.body.sections[0].id;
const pk = (await admin('GET', `/questions?approvedOnly=true&subjectId=${subj.id}&pageSize=50`)).body.data;
check('EA hanya melihat soal disetujui', pk.every((x) => x.approvedVersion) && pk.some((x) => x.id === qid));
const items = pk.slice(0, 3).map((x) => ({ questionVersionId: x.approvedVersion.id }));
const putQ = await admin('PUT', `/admin/exams/${eid}/sections/${sid}/questions`, { items });
check('mengisi soal subtes', putQ.status === 200, `${items.length} soal`);
const dup = await admin('PUT', `/admin/exams/${eid}/sections/${sid}/questions`, { items: [items[0], items[0]] });
check('soal ganda ditolak (FR-EXM-03)', dup.status === 400);
const from = new Date(Date.now() - 60000).toISOString();
const until = new Date(Date.now() + 30 * 86400e3).toISOString();
await admin('PATCH', `/admin/exams/${eid}`, { durationMinutes: 10, availableFrom: from, availableUntil: until, maxAttempts: 2 });
const noSeason = await admin('POST', `/admin/exams/${eid}/publish`, { dryRun: true });
check('publikasi tanpa musim ditolak (FR-EXM-06)', noSeason.body.issues?.some((i) => i.issue === 'SEASON_MISSING'));
const pricing = await admin('PUT', `/admin/exams/${eid}/pricing`, { priceAmount: 49000 });
check('harga per exam dihapus v3.0 (404)', pricing.status === 404);
const seasons = (await admin('GET', '/admin/series')).body.data;
const season = seasons.find((x) => x.code === 'SNBT-2027');
await admin('PATCH', `/admin/exams/${eid}`, { seriesId: season.id });
const pub = await admin('POST', `/admin/exams/${eid}/publish`, { confirmWarnings: true });
check('publikasi exam', pub.status === 200 && pub.body.exam.status === 'PUBLISHED');
const lockedStruct = await admin('PUT', `/admin/exams/${eid}/sections/${sid}/questions`, { items: items.slice(0, 1) });
check('struktur terkunci setelah terbit', lockedStruct.body?.error?.code === 'EXAM_STRUCTURE_LOCKED');
const forbid = await siswa('GET', '/admin/exams');
check('siswa tidak dapat membuka endpoint admin', forbid.status === 403);
const cat = await siswa('GET', '/catalog/products');
check('exam baru tampil di katalog musim', cat.body.data.some((e) => e.id === eid));
const unpub = await admin('POST', `/admin/exams/${eid}/unpublish`, { reason: 'Uji asap selesai, tarik kembali.' });
check('tarik dari katalog', unpub.status === 200);
const cat2 = await siswa('GET', '/catalog/products');
check('exam hilang dari katalog setelah ditarik (BR-AVL-04)', !cat2.body.data.some((e) => e.id === eid));

// Seri dan peringatan parameter produk (EP-SER, FR-EXM-13)
const code = 'SMOKE-' + Date.now().toString(36).toUpperCase();
const badType = await admin('POST', '/admin/series', { code, name: 'Seri Uji Asap', examType: 'MINI_TRYOUT' });
check('tipe Mini ditolak v3.0', badType.status === 400);
const ser = await admin('POST', '/admin/series', { code, name: 'Musim Uji Asap', examDate: '2027-05-20' });
check('membuat musim dengan tanggal SNBT', ser.status === 201);
const serList = (await admin('GET', '/admin/series')).body.data;
check('tanggal SNBT tersimpan', serList.find((x) => x.code === code)?.examDate === '2027-05-20');
const mm = await admin('POST', '/admin/exams', { title: 'Mini Uji Asap', examType: 'MINI_TRYOUT', deliveryMode: 'ON_DEMAND', timingMode: 'TOTAL' });
check('tipe exam selain FULL_TRYOUT ditolak', mm.status === 400);
const mini = await admin('POST', '/admin/exams', { title: 'Periode Uji Asap', deliveryMode: 'ON_DEMAND', timingMode: 'TOTAL', seriesId: ser.body.series.id });
check('exam Full Try Out dalam musim', mini.status === 201);
const md = await admin('GET', `/admin/exams/${mini.body.exam.id}`);
check('detail exam memuat seri', md.body.exam?.seriesId === ser.body.series.id || md.body.seriesId === ser.body.series.id);
await admin('PUT', `/admin/exams/${mini.body.exam.id}/sections/${md.body.sections[0].id}/questions`, { items });
await admin('PATCH', `/admin/exams/${mini.body.exam.id}`, { durationMinutes: 10, availableFrom: from, availableUntil: until });
const mdry = await admin('POST', `/admin/exams/${mini.body.exam.id}/publish`, { dryRun: true });
check('dry run memuat peringatan parameter Full Try Out', mdry.body.warnings?.some((w) => w.issue === 'FULL_QUESTION_COUNT'), mdry.body.warnings?.map((w) => w.message).join('; '));
const mpub = await admin('POST', `/admin/exams/${mini.body.exam.id}/publish`, {});
check('terbit tanpa konfirmasi ditolak', mpub.body?.error?.code === 'PUBLISH_WARNINGS_UNCONFIRMED');
const mpub2 = await admin('POST', `/admin/exams/${mini.body.exam.id}/publish`, { confirmWarnings: true });
check('terbit setelah konfirmasi', mpub2.status === 200 && mpub2.body.exam.status === 'PUBLISHED');
await admin('POST', `/admin/exams/${mini.body.exam.id}/unpublish`, { reason: 'Uji asap selesai, tarik kembali.' });

console.log(failures ? `\n${failures} pemeriksaan GAGAL` : '\nSemua pemeriksaan lolos');
process.exit(failures ? 1 : 0);
