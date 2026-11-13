// Data contoh untuk pengembangan lokal. JANGAN dijalankan di produksi.
// Kata sandi seluruh akun contoh: lihat README (bagian "Akun contoh").
// Soal-soal di bawah ditulis khusus untuk data contoh ini, bukan diambil dari sumber lain.
import argon2 from 'argon2';
import crypto from 'node:crypto';

const DEV_PASSWORD = 'Cogniverse#2026';
const TERMS_VERSION = '2026-11';

const ROLE = {
  STUDENT: '00000000-0000-7000-8000-000000000001',
  CONTRIBUTOR: '00000000-0000-7000-8000-000000000002',
  CONTENT_EDITOR: '00000000-0000-7000-8000-000000000003',
  EXAM_ADMIN: '00000000-0000-7000-8000-000000000004',
  SUPER_ADMIN: '00000000-0000-7000-8000-000000000005',
};

const USERS = [
  { key: 'editor', email: 'editor@cogniverse.test', name: 'Laras Editor', roles: ['CONTENT_EDITOR'] },
  { key: 'tutor', email: 'tutor@cogniverse.test', name: 'Sinta Tutor', roles: ['CONTRIBUTOR'] },
  { key: 'admin', email: 'admin@cogniverse.test', name: 'Dimas Admin', roles: ['EXAM_ADMIN'] },
  { key: 'super', email: 'superadmin@cogniverse.test', name: 'Rahma Super Admin', roles: ['SUPER_ADMIN'] },
  { key: 'siswa', email: 'siswa@cogniverse.test', name: 'Nadia Putri', roles: ['STUDENT'], profile: true },
];

const SUBJECTS = [
  ['PU', 'Penalaran Umum', [['PU-IND', 'Penalaran Induktif'], ['PU-DED', 'Penalaran Deduktif'], ['PU-KUA', 'Penalaran Kuantitatif']]],
  ['PPU', 'Pengetahuan dan Pemahaman Umum', [['PPU-KOS', 'Kosakata'], ['PPU-MAK', 'Makna Kalimat']]],
  ['PBM', 'Pemahaman Bacaan dan Menulis', [['PBM-EJA', 'Ejaan dan Tanda Baca'], ['PBM-KAL', 'Kalimat Efektif']]],
  ['PK', 'Pengetahuan Kuantitatif', [['PK-ALJ', 'Aljabar'], ['PK-GEO', 'Geometri'], ['PK-ARI', 'Aritmetika']]],
  ['LBI', 'Literasi dalam Bahasa Indonesia', [['LBI-IDE', 'Ide Pokok'], ['LBI-SIM', 'Simpulan dan Detail Bacaan']]],
  ['LBE', 'Literasi dalam Bahasa Inggris', [['LBE-MAI', 'Main Idea and Details'], ['LBE-VOC', 'Vocabulary in Context']]],
  ['PM', 'Penalaran Matematika', [['PM-STA', 'Statistika'], ['PM-PEL', 'Peluang']]],
];

const p = (s) => `<p>${s}</p>`;
const BACAAN_LBI =
  'Sebuah sekolah menerapkan jam baca 15 menit sebelum pelajaran dimulai. Setelah satu semester, rata-rata kunjungan siswa ke perpustakaan naik dari 40 menjadi 65 siswa per hari. Namun, guru mencatat bahwa nilai ujian bahasa belum menunjukkan perubahan yang berarti.';
const BACAAN_LBE =
  'Many cities are planting trees along busy roads. Trees provide shade, which can lower street temperatures by several degrees on hot days. They also absorb some air pollutants. However, trees need regular care, and young trees often die if they are not watered during their first two summers.';
const bacaan = (t) => `<blockquote><p>${t}</p></blockquote>`;

// [topicCode, difficulty, cognitive, stemHtml, [A..E], correctKey, explanationHtml]
const QUESTIONS = [
  ['PU-DED', 'EASY', 'ANALYZE', p('Semua siswa kelas XII yang mengikuti try out mendapat laporan analisis. Rina adalah siswa kelas XII yang tidak mendapat laporan analisis. Simpulan yang tepat adalah …'),
    ['Rina mengikuti try out.', 'Rina tidak mengikuti try out.', 'Rina bukan siswa kelas XII.', 'Sebagian siswa kelas XII tidak mendapat laporan analisis walaupun mengikuti try out.', 'Tidak dapat disimpulkan.'], 'B',
    p('Premis berbentuk “jika siswa kelas XII mengikuti try out, maka ia mendapat laporan”. Rina tidak mendapat laporan, sehingga menurut <em>modus tollens</em> Rina tidak mengikuti try out.')],
  ['PU-DED', 'MEDIUM', 'ANALYZE', p('Semua pelari maraton berlatih setiap pagi. Sebagian anggota klub atletik adalah pelari maraton. Simpulan yang tepat adalah …'),
    ['Semua anggota klub atletik berlatih setiap pagi.', 'Sebagian anggota klub atletik berlatih setiap pagi.', 'Semua yang berlatih setiap pagi adalah pelari maraton.', 'Tidak ada anggota klub atletik yang berlatih setiap pagi.', 'Sebagian pelari maraton bukan anggota klub atletik.'], 'B',
    p('Anggota klub yang merupakan pelari maraton pasti berlatih setiap pagi. Karena sebagian anggota adalah pelari maraton, maka sebagian anggota berlatih setiap pagi. Pilihan lain tidak dapat dipastikan dari premis.')],
  ['PU-DED', 'MEDIUM', 'ANALYZE', p('Jika Doni lulus ujian, ia akan kuliah di Bandung. Jika Doni kuliah di Bandung, ia akan tinggal bersama pamannya. Ternyata Doni tidak tinggal bersama pamannya. Simpulan yang tepat adalah …'),
    ['Doni lulus ujian dan kuliah di Bandung.', 'Doni tidak lulus ujian.', 'Doni kuliah di Bandung.', 'Doni tinggal bersama pamannya.', 'Doni lulus ujian tetapi tidak kuliah.'], 'B',
    p('Dari dua premis diperoleh: jika lulus ujian, maka tinggal bersama paman (silogisme). Karena Doni tidak tinggal bersama paman, maka Doni tidak lulus ujian (<em>modus tollens</em>).')],

  ['PPU-KOS', 'EASY', 'REMEMBER', p('Sinonim kata <strong>efisien</strong> adalah …'),
    ['hemat dan tepat guna', 'cepat dan terburu-buru', 'mahal', 'rumit', 'lambat'], 'A',
    p('<em>Efisien</em> berarti tepat atau sesuai untuk menghasilkan sesuatu tanpa membuang waktu, tenaga, atau biaya; maknanya paling dekat dengan “hemat dan tepat guna”.')],
  ['PPU-KOS', 'EASY', 'REMEMBER', p('Antonim kata <strong>konkret</strong> adalah …'),
    ['nyata', 'abstrak', 'padat', 'jelas', 'pasti'], 'B',
    p('<em>Konkret</em> berarti nyata atau berwujud. Lawan katanya adalah <em>abstrak</em>, yaitu tidak berwujud.')],
  ['PPU-KOS', 'MEDIUM', 'UNDERSTAND', p('Kata <strong>mitigasi</strong> dalam kalimat “Pemerintah menyiapkan langkah mitigasi bencana banjir” paling tepat bermakna …'),
    ['penanggulangan setelah bencana terjadi', 'upaya mengurangi risiko dan dampak bencana', 'pendataan korban bencana', 'pemindahan seluruh penduduk', 'perayaan setelah bencana berlalu'], 'B',
    p('<em>Mitigasi</em> adalah tindakan untuk mengurangi risiko dan dampak bencana, dilakukan terutama sebelum bencana terjadi.')],

  ['PBM-EJA', 'EASY', 'APPLY', p('Penulisan kata depan yang tepat terdapat pada kalimat …'),
    ['Buku itu diletakkan dimeja.', 'Ia pergi kepasar.', 'Surat itu dikirim ke Surabaya.', 'Adik bermain diluar rumah.', 'Kami berangkat darisekolah.'], 'C',
    p('Kata depan <em>di</em>, <em>ke</em>, dan <em>dari</em> ditulis terpisah dari kata yang mengikutinya: <em>di meja</em>, <em>ke pasar</em>, <em>di luar</em>, <em>dari sekolah</em>. Hanya pilihan C yang benar.')],
  ['PBM-EJA', 'EASY', 'APPLY', p('Penggunaan tanda koma yang tepat terdapat pada kalimat …'),
    ['Saya membeli buku, pensil, dan penghapus.', 'Saya membeli buku pensil, dan penghapus.', 'Saya, membeli buku pensil dan penghapus.', 'Saya membeli, buku, pensil, dan penghapus.', 'Saya membeli buku, pensil dan, penghapus.'], 'A',
    p('Tanda koma dipakai di antara unsur-unsur dalam suatu pemerincian, termasuk sebelum kata <em>dan</em> pada pemerincian tiga unsur atau lebih.')],
  ['PBM-EJA', 'MEDIUM', 'REMEMBER', p('Kata yang ditulis sesuai bentuk baku adalah …'),
    ['aktifitas', 'apotik', 'kualitas', 'resiko', 'nasehat'], 'C',
    p('Bentuk baku: <em>aktivitas</em>, <em>apotek</em>, <em>kualitas</em>, <em>risiko</em>, <em>nasihat</em>. Hanya <em>kualitas</em> yang sudah ditulis dalam bentuk baku.')],

  ['PK-ALJ', 'EASY', 'APPLY', p('Jika \\(2x + 3 = 11\\), nilai \\(x\\) adalah …'),
    ['2', '3', '4', '5', '7'], 'C',
    p('\\(2x = 11 - 3 = 8\\), sehingga \\(x = 4\\).')],
  ['PK-ALJ', 'MEDIUM', 'APPLY', p('Jika \\(3(x - 2) = 2x + 5\\), nilai \\(x\\) adalah …'),
    ['1', '7', '9', '11', '13'], 'D',
    p('\\(3x - 6 = 2x + 5\\) sehingga \\(x = 11\\).')],
  ['PK-ALJ', 'MEDIUM', 'APPLY', p('Jika \\(a + b = 10\\) dan \\(a - b = 4\\), nilai \\(a \\times b\\) adalah …'),
    ['21', '24', '25', '28', '30'], 'A',
    p('Menjumlahkan kedua persamaan: \\(2a = 14\\), jadi \\(a = 7\\) dan \\(b = 3\\). Maka \\(a \\times b = 21\\).')],

  ['LBI-SIM', 'MEDIUM', 'ANALYZE', bacaan(BACAAN_LBI) + p('Simpulan yang paling tepat berdasarkan bacaan tersebut adalah …'),
    ['Jam baca terbukti meningkatkan nilai ujian bahasa.', 'Jam baca berkaitan dengan meningkatnya kunjungan ke perpustakaan, tetapi pengaruhnya pada nilai ujian bahasa belum terlihat.', 'Perpustakaan sekolah kurang diminati siswa.', 'Jam baca sebaiknya dihentikan.', 'Nilai ujian bahasa menurun setelah jam baca diterapkan.'], 'B',
    p('Bacaan menyebut kunjungan perpustakaan naik, sedangkan nilai ujian bahasa belum berubah berarti. Simpulan B memuat kedua informasi itu tanpa menambah klaim di luar bacaan.')],
  ['LBI-SIM', 'EASY', 'UNDERSTAND', bacaan(BACAAN_LBI) + p('Kenaikan rata-rata kunjungan siswa ke perpustakaan per hari adalah …'),
    ['15 siswa', '25 siswa', '40 siswa', '65 siswa', '105 siswa'], 'B',
    p('Kunjungan naik dari 40 menjadi 65 siswa per hari, sehingga kenaikannya \\(65 - 40 = 25\\) siswa.')],
  ['LBI-SIM', 'EASY', 'UNDERSTAND', bacaan(BACAAN_LBI) + p('Pernyataan yang <strong>tidak</strong> sesuai dengan bacaan adalah …'),
    ['Jam baca berlangsung 15 menit.', 'Jam baca dilakukan sebelum pelajaran dimulai.', 'Perubahan kunjungan diamati setelah satu semester.', 'Nilai ujian bahasa naik tajam.', 'Guru memperhatikan nilai ujian bahasa.'], 'D',
    p('Bacaan menyatakan nilai ujian bahasa <em>belum menunjukkan perubahan yang berarti</em>, jadi pernyataan bahwa nilai naik tajam tidak sesuai.')],

  ['LBE-MAI', 'MEDIUM', 'UNDERSTAND', bacaan(BACAAN_LBE) + p('What is the main idea of the text?'),
    ['Trees are too expensive to plant in cities.', 'Roadside trees offer benefits but require regular care.', 'Air pollution in cities is getting worse.', 'Young trees cannot survive in cities.', 'Cities should stop building busy roads.'], 'B',
    p('The text lists the benefits of roadside trees (shade, lower temperatures, absorbing pollutants) and then notes that they need care. Option B covers both parts.')],
  ['LBE-MAI', 'EASY', 'UNDERSTAND', bacaan(BACAAN_LBE) + p('The word <strong>absorb</strong> in the text is closest in meaning to …'),
    ['release', 'take in', 'produce', 'block', 'ignore'], 'B',
    p('To <em>absorb</em> pollutants means to take them in.')],
  ['LBE-MAI', 'EASY', 'REMEMBER', bacaan(BACAAN_LBE) + p('According to the text, young trees often die when …'),
    ['they are planted near roads', 'they are not watered during their first two summers', 'street temperatures drop', 'air pollution is high', 'they receive too much shade'], 'B',
    p('The last sentence states that young trees often die if they are not watered during their first two summers.')],

  ['PM-STA', 'EASY', 'APPLY', p('Rata-rata dari data 6, 7, 8, 9, 10 adalah …'),
    ['7', '7,5', '8', '8,5', '9'], 'C',
    p('\\(\\dfrac{6+7+8+9+10}{5} = \\dfrac{40}{5} = 8\\).')],
  ['PM-STA', 'MEDIUM', 'APPLY', p('Nilai rata-rata 4 siswa adalah 70. Jika seorang siswa lain dengan nilai 80 bergabung, nilai rata-rata kelima siswa adalah …'),
    ['71', '72', '74', '75', '76'], 'B',
    p('Jumlah nilai awal \\(4 \\times 70 = 280\\). Jumlah baru \\(280 + 80 = 360\\), sehingga rata-rata \\(360 \\div 5 = 72\\).')],
  ['PM-STA', 'MEDIUM', 'APPLY', p('Median dari data 3, 9, 4, 7, 5, 8 adalah …'),
    ['5', '5,5', '6', '6,5', '7'], 'C',
    p('Data terurut: 3, 4, 5, 7, 8, 9. Banyak data genap, sehingga median \\(= \\dfrac{5 + 7}{2} = 6\\).')],
];

const KEYS = ['A', 'B', 'C', 'D', 'E'];
const uuid = () => crypto.randomUUID();
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\\\(|\\\)/g, '').replace(/\s+/g, ' ').trim();

export default async function seed(c) {
  const hash = await argon2.hash(DEV_PASSWORD, { type: argon2.argon2id });
  const uid = {};
  for (const u of USERS) {
    const r = await c.query(
      `INSERT INTO users (email, password_hash, full_name, status, email_verified_at)
       VALUES ($1, $2, $3, 'ACTIVE', now()) RETURNING id`, [u.email, hash, u.name]);
    uid[u.key] = r.rows[0].id;
    for (const role of u.roles) {
      await c.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [uid[u.key], ROLE[role]]);
    }
    await c.query(
      `INSERT INTO user_consents (user_id, document_type, document_version) VALUES ($1,'TERMS',$2),($1,'PRIVACY',$2)`,
      [uid[u.key], TERMS_VERSION]);
    if (u.profile) {
      await c.query(
        `INSERT INTO student_profiles (user_id, student_status, school_name, graduation_year, province, onboarding_completed_at)
         VALUES ($1, 'GRADE_12', 'SMA Negeri 1 Contoh', 2027, 'Jawa Barat', now())`, [uid[u.key]]);
    }
  }
  await c.query(`INSERT INTO user_consents (user_id, document_type, document_version) VALUES ($1,'CONTRIBUTOR_AGREEMENT',$2)`,
    [uid.tutor, TERMS_VERSION]);

  const topic = {};
  const subjectOf = {};
  let pos = 1;
  for (const [code, name, topics] of SUBJECTS) {
    const s = await c.query('INSERT INTO subjects (code, name, position) VALUES ($1,$2,$3) RETURNING id', [code, name, pos++]);
    for (const [tcode, tname] of topics) {
      const t = await c.query('INSERT INTO topics (subject_id, code, name) VALUES ($1,$2,$3) RETURNING id', [s.rows[0].id, tcode, tname]);
      topic[tcode] = t.rows[0].id;
      subjectOf[tcode] = s.rows[0].id;
    }
  }

  // Alur penuh per soal: DRAFT oleh tutor -> opsi -> IN_REVIEW -> APPROVED oleh editor (BR-QV-04)
  const approved = []; // { questionId, versionId, topicCode }
  for (const [tcode, diff, cog, stem, opts, correct, expl] of QUESTIONS) {
    const q = await c.query('INSERT INTO questions (author_id) VALUES ($1) RETURNING id', [uid.tutor]);
    const v = await c.query(
      `INSERT INTO question_versions (question_id, version_number, status, author_id, subject_id, topic_id,
         difficulty, cognitive_level, stem_html, stem_plain, explanation_html)
       VALUES ($1, 1, 'DRAFT', $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [q.rows[0].id, uid.tutor, subjectOf[tcode], topic[tcode], diff, cog, stem, plain(stem), expl]);
    const vid = v.rows[0].id;
    for (let i = 0; i < opts.length; i++) {
      await c.query(
        'INSERT INTO question_options (question_version_id, option_key, content_html, is_correct) VALUES ($1,$2,$3,$4)',
        [vid, KEYS[i], p(opts[i]), KEYS[i] === correct]);
    }
    await c.query(`UPDATE question_versions SET status = 'IN_REVIEW', submitted_at = now() WHERE id = $1`, [vid]);
    await c.query(`INSERT INTO question_reviews (question_version_id, reviewer_id, decision) VALUES ($1, $2, 'APPROVED')`, [vid, uid.editor]);
    await c.query(`UPDATE question_versions SET status = 'APPROVED', decided_at = now(), decided_by = $2 WHERE id = $1`, [vid, uid.editor]);
    approved.push({ questionId: q.rows[0].id, versionId: vid, topicCode: tcode });
  }

  // ------------------------------------------------------------------ v3.0: musim, Full Try Out per periode, paket
  // Tanggal SNBT di bawah adalah TANGGAL CONTOH PENGEMBANGAN, bukan jadwal resmi (OQ-25).
  const season = await c.query(
    `INSERT INTO exam_series (code, name, description, exam_type, exam_date, created_by)
     VALUES ('SNBT-2027', 'Try Out SNBT 2027', 'Musim contoh pengembangan: tiga periode Full Try Out dengan susunan setara.',
             'FULL_TRYOUT', (now() + interval '150 days')::date, $1) RETURNING id`, [uid.admin]);
  const seasonId = season.rows[0].id;
  const SECTIONS = [
    ['Penalaran Umum', 'PU-DED'], ['Pengetahuan dan Pemahaman Umum', 'PPU-KOS'], ['Pemahaman Bacaan dan Menulis', 'PBM-EJA'],
    ['Pengetahuan Kuantitatif', 'PK-ALJ'], ['Literasi dalam Bahasa Indonesia', 'LBI-SIM'],
    ['Literasi dalam Bahasa Inggris', 'LBE-MAI'], ['Penalaran Matematika', 'PM-STA'],
  ];
  async function createPeriod(n, opensInDays) {
    const e = await c.query(
      `INSERT INTO exams (slug, title, description, instructions_html, exam_type, delivery_mode, timing_mode, status,
         duration_minutes, max_attempts, created_by, series_id)
       VALUES ($1,$2,$3,$4,'FULL_TRYOUT','ON_DEMAND','PER_SECTION','DRAFT',NULL,1,$5,$6) RETURNING id`,
      [`tryout-snbt-2027-periode-${n}`, `Try Out SNBT 2027 Periode ${n}`,
       'Simulasi tujuh subtes SNBT dengan timer per subtes. Data contoh pengembangan: 21 soal, 5 menit per subtes.',
       '<p>Kerjakan tanpa bantuan orang lain atau mesin pencari agar hasilnya benar-benar menggambarkan kemampuanmu saat ini.</p>',
       uid.admin, seasonId]);
    const examId = e.rows[0].id;
    let sp = 1;
    for (const [name, tcode] of SECTIONS) {
      const s = await c.query(
        'INSERT INTO exam_sections (exam_id, name, position, duration_minutes) VALUES ($1,$2,$3,5) RETURNING id', [examId, name, sp++]);
      let qp = 1;
      for (const item of approved.filter((a) => a.topicCode === tcode)) {
        await c.query(
          `INSERT INTO exam_questions (exam_id, exam_section_id, question_id, question_version_id, position)
           VALUES ($1,$2,$3,$4,$5)`, [examId, s.rows[0].id, item.questionId, item.versionId, qp++]);
      }
    }
    await c.query(
      `UPDATE exams SET status = 'PUBLISHED', published_at = now(), published_by = $2,
         available_from = now() + make_interval(days => $3::int), available_until = now() + interval '140 days' WHERE id = $1`,
      [examId, uid.admin, opensInDays]);
  }
  await createPeriod(1, -7);
  await createPeriod(2, -1);
  await createPeriod(3, 30);

  // Paket [Established]: Rp35.000 (1 kredit), Rp79.000 (4 kredit), Rp150.000 (akses musim sampai H-7)
  for (const [slug, type, name, price, credits, order, desc] of [
    ['paket-try-out-umum', 'SINGLE', 'Try Out Umum', 35000, 1, 1, '1 periode Full Try Out pilihan.'],
    ['paket-bundle', 'BUNDLE', 'Bundle', 79000, 4, 2, '4 periode Full Try Out pilihan.'],
    ['paket-lifetime', 'LIFETIME', 'Lifetime', 150000, null, 3, 'Semua periode Full Try Out musim ini sampai H-7 SNBT.'],
  ]) {
    await c.query(
      `INSERT INTO products (slug, product_type, name, description, price_amount, status, created_by, is_package, tryout_credits, series_id, display_order)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,TRUE,$7,$8,$9)`, [slug, type, name, desc, price, uid.admin, credits, seasonId, order]);
  }

  // Data kampus: nama saja. Skor acuan TIDAK diisi karena belum ada sumber data (OQ-20, BR-TGT-02).
  for (const [uni, short, prov, programs] of [
    ['Universitas Indonesia', 'UI', 'Jawa Barat', ['Pendidikan Dokter', 'Ilmu Komputer', 'Psikologi', 'Akuntansi']],
    ['Institut Teknologi Bandung', 'ITB', 'Jawa Barat', ['Teknik Informatika', 'Sekolah Teknik Elektro dan Informatika', 'Fakultas Teknik Sipil dan Lingkungan']],
    ['Universitas Gadjah Mada', 'UGM', 'DI Yogyakarta', ['Kedokteran', 'Ilmu Komputer', 'Hukum', 'Manajemen']],
    ['Institut Teknologi Sepuluh Nopember', 'ITS', 'Jawa Timur', ['Teknik Informatika', 'Sistem Informasi', 'Teknik Mesin']],
    ['Universitas Airlangga', 'UNAIR', 'Jawa Timur', ['Pendidikan Dokter', 'Farmasi', 'Hukum']],
  ]) {
    const u = await c.query('INSERT INTO universities (name, short_name, province) VALUES ($1,$2,$3) RETURNING id', [uni, short, prov]);
    for (const prog of programs) await c.query('INSERT INTO study_programs (university_id, name) VALUES ($1,$2)', [u.rows[0].id, prog]);
  }

  // Panduan materi contoh per topik (FR-RMP-05); dikelola Content Editor setelahnya
  const GUIDES = {
    'PU-DED': ['Penalaran deduktif menarik kesimpulan yang pasti benar dari premis yang diberikan.', ['Bedakan premis umum dan premis khusus', 'Silogisme: semua A adalah B; C adalah A; maka C adalah B', 'Kesimpulan tidak boleh memakai informasi di luar premis', 'Waspadai pernyataan "beberapa" dan "tidak semua"']],
    'PPU-KOS': ['Kosakata diuji lewat makna kata dalam konteks kalimat, bukan hafalan kamus.', ['Tebak makna dari kalimat sekitarnya', 'Kenali imbuhan yang mengubah makna', 'Bedakan sinonim yang tepat konteks dan yang hanya mirip']],
    'PBM-EJA': ['Ejaan dan tanda baca mengikuti Pedoman Umum Ejaan Bahasa Indonesia (EYD).', ['Huruf kapital pada nama diri, judul, dan awal kalimat', 'Kata depan "di" dan "ke" ditulis terpisah; awalan "di-" disambung', 'Koma sebelum "tetapi", "melainkan", dan "sedangkan"']],
    'PK-ALJ': ['Aljabar menekankan manipulasi persamaan dan bentuk aljabar dengan rapi.', ['Pindahkan suku dengan mengubah tanda', 'Faktorkan bentuk kuadrat sebelum menyelesaikan', 'Periksa jawaban dengan substitusi kembali']],
    'LBI-SIM': ['Simpulan bacaan harus didukung isi teks, bukan pendapat pembaca.', ['Cari kalimat yang merangkum hubungan sebab-akibat', 'Hindari pilihan yang terlalu luas atau terlalu sempit', 'Bedakan fakta dalam teks dan dugaan']],
    'LBE-MAI': ['Main idea is the point that the whole passage supports.', ['Read the first and last sentences carefully', 'Eliminate options that only describe one detail', 'Check that every paragraph supports your choice']],
    'PM-STA': ['Statistika dasar: ukuran pemusatan dan penyebaran data.', ['Rata-rata = jumlah data dibagi banyak data', 'Median: urutkan data dulu', 'Modus: nilai yang paling sering muncul', 'Perubahan satu data ekstrem memengaruhi rata-rata lebih dari median']],
  };
  for (const [tcode, [summary, points]] of Object.entries(GUIDES)) {
    await c.query('INSERT INTO topic_guides (topic_id, summary, key_points, updated_by) VALUES ($1,$2,$3,$4)',
      [topic[tcode], summary, JSON.stringify(points), uid.editor]);
  }
}
