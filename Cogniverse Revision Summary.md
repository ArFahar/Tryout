# Cogniverse Revision Summary

| Atribut | Nilai |
|---|---|
| Tanggal | 13 November 2026 (v3.0); 11 November 2026 (v2.0) |
| Status | **v3.0 — dokumen dan kode diselaraskan** dengan cakupan di Bagian 10. PRD v3.0, TDD v3.0, dan UI/UX Specification v3.0 direvisi; audit lintas dokumen UI/UX 12.1 lolos 9/9 gerbang. Bagian 1–9 di bawah adalah ringkasan revisi v2.0 dan dipertahankan sebagai riwayat |
| Cadangan | v1: scratchpad sesi `v1/`; v2.0: scratchpad sesi `v2/` (salinan keempat dokumen sebelum revisi v3.0) |

## 1. Strategic Changes

- Positioning: dari "Cogniverse Assessment Platform" menjadi **platform pendampingan dan pengembangan siswa**; try out adalah *gateway*, bukan identitas akhir (PRD 2.1–2.3, 2.10).
- Empat tahap ekosistem: Acquisition (Free Try Out) → Differentiation (Premium + Performance Intelligence) → Retention (Progress, Personalized Learning) → Long-term Value (Mentoring, University Preparation).
- Alur MVP: Discover → Register → Free Try Out → Result → Premium Try Out → Performance Report.

## 2. Product Changes (PRD v2.0)

| Diubah | Isi |
|---|---|
| Taksonomi | `DIAGNOSTIC`/`TRYOUT` → `FREE_TRYOUT` / `MINI_TRYOUT` / `FULL_TRYOUT`; Bundle tetap `product_type`; **seri try out** untuk perbandingan |
| Parameter | 15–25 soal, 20–30 menit, attempt Free Try Out → pengaturan sistem dengan peringatan publish (bukan constraint) |
| Performance Intelligence | Modul FR-PI (menggantikan FR-ANL) dengan lima dimensi; insight berlabel pengamatan/dugaan dengan bukti; rekomendasi area prioritas naik ke P0 |
| Laporan | Tingkatan BASIC (Free) dan COMPLETE (Mini/Full); BASIC wajib bermakna, pembahasan tetap tersedia |
| Baru | FR-CAT (katalog, halaman publik), FR-PRG (progres), FR-FUT (modul masa depan), BR-FRE, BR-PI, BR-PRG, BR-PRV, persona jalur non-SNBT, KPI berlabel hipotesis |
| Diserap | Penajaman TDD P-01..P-11 dan temuan audit AU-01..AU-11 (mis. batas ruang tunggu 30 menit dihapus) |

Hasil: 185 FR (134 P0, 37 P1, 14 P2), 119 BR, 17 journey, 24 edge case; seluruh rujukan ID diverifikasi otomatis.

## 3. Technical Changes (TDD v2.0)

- Modul `PerformanceIntelligence`, `Configuration`, `Programs` (15 modul). Pipeline 6.6: agregat deterministik dalam transaksi scoring, aturan ber-versi di pekerjaan `result.analyze`.
- 13 tabel baru (50 total): `competencies`, `question_competencies`, `exam_series`, `result_competency_scores`, `result_behavior_metrics`, `result_analyses`, `performance_insights`, `learning_recommendations`, `insight_feedback`, `student_performance_snapshots`, `system_settings`, `program_interests`, `data_export_requests`. Kolom baru `attempt_answers.first_selected_option_id`, `answer_change_count`.
- 22 endpoint baru, 12 diubah (122 total); matriks RBAC per resource (5.3a); 25 test case baru (97 total); matriks P0 lengkap.
- **Terverifikasi:** DDL 3.5–3.8 dijalankan pada PostgreSQL 16 (50 tabel, 43 trigger) via `cogniverse-platform/scripts/verify-tdd-ddl.mjs`; migrasi v1→v2 `cogniverse-platform/db/migrations/0005_v2_realignment.sql` (dipindah dari `db/proposed/` saat penyelarasan kode) dijalankan pada skema tonggak 1 berisi data via `scripts/verify-migration-v2.mjs`.
- OQ-T4 diputuskan: SQL berparameter tanpa ORM (bukti tonggak 1).

## 4. UX Changes (UI/UX v2.0)

- **Arah visual bergaya Apple** menggantikan referensi v1.1: prinsip Clarity, Deference, Depth; tipografi sistem besar (fallback Inter), satu aksen biru `#0071E3`, tombol pil, kartu `radius` 18 px tanpa garis tepi, navigasi tembus pandang, ruang putih lapang. Tidak memakai logo, SF Pro, SF Symbols, atau foto Apple (UI 1.6). Hover menggelap demi kontras AA; seluruh pasangan warna dihitung (UI 6.3).
- **Redaksi ditulis ulang dengan prinsip copywriting** (UI 9.0): beranda lengkap dengan anotasi, alternatif judul dan CTA, meta; Free vs Premium; aplikasi siswa; kamus tombol; subjek email. Tanpa testimoni atau angka yang dikarang.
- **IA:** 50 layar (7 baru: PUB-12 Detail Free Try Out, STU-13 Progres, STU-14 Rekomendasi, STU-15 Try Out Tersedia, STU-16 Learning & Mentoring, ADM-14 Seri, CTR-05 Riwayat Kontribusi); sitemap dipetakan ke struktur yang diminta.
- **Flow:** 14 diagram; empat baru (penemuan pertama, hasil dasar, eksplorasi PI, progres); peta sembilan flow yang diminta (UI 3.0).
- **Wireframe:** 18; baru/ditulis ulang: Beranda, Detail Free Try Out, Registrasi, Ringkasan Siswa, Laporan Performance Intelligence (hierarki enam bagian, varian BASIC, lembar bukti), Progres; Exam Builder ditambah tipe, seri, dan peringatan parameter.
- **Design system:** komponen baru Charts, Insight Card (Pengamatan vs Dugaan), kontrol bersegmen, `material-bar`.
- **Audit lintas dokumen:** 17 butir quality gate; matriks 134 FR P0 dibangkitkan otomatis; seluruh rujukan ID, kode error, dan cakupan layar diverifikasi skrip.

## 5. Retained / Removed

- Dipertahankan: engine hybrid, timer server-authoritative, versioning dan snapshot, review empat mata, akses dari webhook, result immutable, nama token design system v1.x (nilainya diganti, UI 6.1).
- Dihapus: tipe `DIAGNOSTIC`/`TRYOUT`, constraint diagnostic satu attempt, `WAITING_ROOM_MINUTES`, ambang analitik sebagai variabel lingkungan, modul Analytics hanya-baca.

## 6. Outstanding Questions

OQ-U1 (logo), OQ-U9 (batas kemiripan gaya Apple), OQ-13 (validasi persona), OQ-14 (kerangka kompetensi), OQ-15 (isi BASIC vs COMPLETE), OQ-16 (kesetaraan dalam seri), OQ-T1 (payment gateway), OQ-T2 (hosting), OQ-T9 (kapasitas worker analitik), OQ-08 (UU PDP).

## 7. Development Recommendations

1. ~~Selaraskan kode tonggak 1 ke v2.0~~ — dikerjakan 11 November 2026 (Bagian 9). Sisa pekerjaan di 9.3.
2. Uji kegunaan (OQ-U8) untuk antarmuka ujian, laporan PI, dan redaksi beranda sebelum desain visual final.
3. Bangun pipeline PI (6.6) sebelum Commerce, karena laporan adalah momen aktivasi Free Try Out.

## 8. Technical Risks

- Templat insight yang berlebihan merusak kepercayaan (TC-PI-06 sebagai penjaga).
- Seri yang tidak benar-benar setara membuat progres menyesatkan (tanpa equating statistik).
- Lonjakan analisis di akhir session scheduled (OQ-T9).

## 9. Penyelarasan Kode Tonggak 1 (11 November 2026)

### 9.1 Yang berubah

| Area | Perubahan | Berkas utama |
|---|---|---|
| Database | Migrasi 0005 diterapkan pada DB pengembangan (`db.mjs reset`); seed memakai `FREE_TRYOUT` dan seri `MINI-PU-PK` berisi dua Mini Try Out | `db/migrations/0005_v2_realignment.sql`, `db/seed/seed.mjs` |
| Kontrak | `EXAM_TYPES`, `reportTierOf`, `createSeriesSchema`, `publishSchema`, kode error `PUBLISH_WARNINGS_UNCONFIRMED`, `SERIES_LOCKED`, `SERIES_TYPE_MISMATCH` | `packages/contracts/src/index.ts` |
| Configuration | `system_settings` dibaca dengan cache 30 detik; EP-SET-01/02 | `apps/api/src/common/settings.ts` |
| Exam & seri | Tipe Free/Mini/Full, Free ≤ 3 attempt dan wajib gratis, seri terkunci setelah ada attempt, peringatan parameter produk yang wajib dikonfirmasi saat publish; EP-SER-01..03 | `apps/api/src/content/exams.ts` |
| Engine | Autosave mencatat `first_selected_option_id` dan `answer_change_count` (FR-ENG-17); riwayat memuat seri | `apps/api/src/engine/engine.service.ts` |
| Performance Intelligence | Tahap 1 di transaksi scoring (skor kompetensi, metrik perilaku, snapshot progres, `result_analyses`); tahap 2 aturan `pi-rules-2026.11` (OBS-OVR-01/02, OBS-CAP-01/02/03, OBS-BEH-01/02, INF-BEH-01, REC-PRI-01, REC-ACT-01) + sweeper; EP-PI-01/02, EP-PRG-01/02; filter `topicId` di EP-RES-02 | `apps/api/src/pi/performance-intelligence.ts`, `apps/api/src/scoring/scoring.service.ts` |
| Design system web | Token bergaya Apple (UI 6.1–6.5) menggantikan violet v1.1; tombol pil, kartu tanpa garis tepi, `material-bar`, kontrol bersegmen, Insight Card, Lembar Bukti | `apps/web/src/app/globals.css`, `components/ui.tsx`, `components/pi.tsx` |
| Rute & layar | `/app/asesmen` (pengalihan permanen dari `/app/ujian-saya`), `/bandingkan` (PUB-05), `/app/tryout` (STU-15), `/app/rekomendasi` (STU-14), `/app/progres` (STU-13), `/admin/seri` (ADM-14); STU-08 ditulis ulang menjadi enam bagian; PUB-12 sebagai varian detail; navigasi sesuai UI 2.4 | `apps/web/src/app/**` |
| Redaksi | Beranda (9.0.1, judul A, CTA A), Free vs Premium (9.0.2), aplikasi siswa (9.0.3), kamus tombol (9.0.4). Angka {n}/{m} diambil dari data katalog | `apps/web/src/app/page.tsx` dan halaman terkait |

### 9.2 Verifikasi yang dijalankan

- `tsc --noEmit` lolos untuk `apps/api` dan `apps/web`.
- Uji asap API pada DB yang baru di-reset: `scripts/smoke.mjs`, `smoke-content.mjs`, dan `smoke-timeout.mjs` lolos seluruhnya. Pemeriksaan baru mencakup laporan BASIC vs COMPLETE, rekomendasi menunjuk insight, bahasa bebas kata terlarang, bukti tanpa kunci (TC-PI-10), filter pembahasan per topik, progres per seri, penolakan perbandingan lintas seri, seri dengan tipe tidak cocok, dan konfirmasi peringatan publish. Skrip ini mengasumsikan DB segar; jalankan `node scripts/db.mjs reset` sebelum mengulang.
- Pencatatan perubahan jawaban diperiksa langsung di DB (`answer_change_count` = 2, satu perubahan benar→salah tercatat di `result_behavior_metrics`).
- Browser (desktop dan 375 px): beranda, katalog, Bandingkan, Ringkasan siswa, laporan BASIC dan COMPLETE, lembar bukti → pembahasan per topik, Asesmen Saya + pengalihan, Progres, admin exam builder (dialog peringatan), admin Seri. Tanpa gulir horizontal pada 375 px.

### 9.3 Belum dikerjakan / belum terverifikasi

- Aturan yang **terpicu dan teruji** pada data uji asap: OBS-OVR-01/02, OBS-CAP-01/03, REC-PRI-01, REC-ACT-01. Aturan **OBS-CAP-02, OBS-BEH-01, OBS-BEH-02, dan INF-BEH-01 sudah ditulis tetapi belum terpicu** oleh data uji asap; perlu data uji khusus (mis. soal kosong menumpuk di akhir subtes, akurasi topik ≥ 80%).
- **Skor kompetensi** ditulis bila `question_competencies` terisi; seed belum memetakan kompetensi (OQ-14), jadi tabelnya kosong.
- Belum ada: EP-PI-03 (umpan balik insight, P1), EP-PI-04 (sembunyikan rekomendasi), Bundle, Commerce/pembayaran, sesi terjadwal, STU-16 dan `program_interests`, ekspor data (BR-PRV), varian dark mode.
- Ajakan Premium per topik di akhir bagian 6 laporan BASIC (UI 5.9.3) belum ada karena katalog belum memetakan try out ke topik.
- Navigasi siswa di desktop memakai lima tautan (UI 2.4) tanpa menu Transaksi dan Learning & Mentoring, karena modulnya belum ada.
- Belum di-commit.

## 10. Revisi v3.0 — Reposisi Produk (13 November 2026)

### 10.1 Keputusan pemilik produk [Established]

| Aspek | Keputusan |
|---|---|
| Target market | Siswa kelas 12 |
| Niche | SNBT untuk MVP; SKD berikutnya |
| Produk | Full Try Out per periode; **Free Try Out dan Mini Try Out dihapus** |
| Paket | Try Out Umum (1x) Rp35.000 · Bundle Rp79.000 (4 periode) · Lifetime Rp150.000 (semua periode satu musim sampai H-7 SNBT) |
| Freemium | Akun dan fitur non-ujian saja (target, contoh laporan/roadmap, kode referral); tidak ada try out gratis |
| Referral | 3 orang → diskon 20% |
| Nilai unik | (1) analisis kelemahan/kelebihan + panduan materi; (2) roadmap + plan harian; (3) progress tracker + target skor kampus & jurusan; (4) soal asli 2023–2026 |
| Journey | Login → daftar + pilih target → pilih paket → bayar → akses soal → skoring → pembahasan & diagnosis → rekomendasi & panduan belajar |
| Lain | Target 1.000 audiens Try Out Umum; perbedaan skema paket dibahas fase berikutnya; butir ke-3 model bisnis kosong |

### 10.2 Penafsiran yang diusulkan dokumen [Proposed] — perlu dikonfirmasi

- **Referral** dihitung saat teman **membeli** paket (bukan saat mendaftar), voucher hanya untuk pengajak, berlaku 90 hari (BR-REF-02..04, OQ-24).
- **Kredit** 1x/Bundle berlaku sampai tanggal SNBT musim pembelian; kredit dipakai untuk periode pilihan siswa (BR-PKG-02/03).
- **Ketiga paket memberi fitur yang sama per try out** sampai perbedaan skema diputuskan (BR-PKG-06, OQ-22).
- **"Target 1.000 audiens"** ditafsirkan 1.000 pembeli paket Try Out Umum per musim (OQ-23).
- **Klaim "soal asli"** ditahan; redaksi publik memakai "pola soal SNBT 2023–2026" (OQ-19). **Skor acuan kampus** hanya tampil bila bersumber; siswa menetapkan target pribadi sendiri (BR-TGT, OQ-20).
- Nama **"Lifetime"** dipertahankan dengan cakupan dan tanggal berakhir yang selalu tertulis (BR-PKG-04, OQ-21).

### 10.3 Dokumen

| Dokumen | Perubahan | Verifikasi |
|---|---|---|
| PRD v3.0 | Header, ringkasan, Bagian 2 (positioning, target, persona, empat nilai unik, model bisnis, taksonomi, modul) ditulis ulang; journey 6.0, UJ-01, UJ-02 ditulis ulang; UJ-18..20 baru; modul FR-PKG (7), FR-REF (6), FR-TGT (6), FR-RMP (8) baru; FR-PRG-02..05 naik ke P0; 6 FR ditandai dihapus; BR-FRE diganti BR-PKG/REF/TGT/RMP; MVP, roadmap, OQ-19..26 | Skrip: **207 FR (159 P0, 33 P1, 15 P2)**; seluruh rujukan FR/BR terdefinisi |
| TDD v3.0 | Modul Packages, Referral, Targets, StudyPlanner; 3.4b; **3.5b DDL migrasi 0006 (disalin dari berkas yang dieksekusi)**; 4.22 (24 endpoint baru, 9 diubah, 4 dihapus → 142); RBAC; 6.7 logika paket/penukaran/referral/roadmap/simulator; 16 test case baru; TD-12..15; OQ-T11/12; 11.1 untuk 159 P0 | Skrip: 159/159 P0 terpetakan; seluruh endpoint yang dirujuk terdefinisi |
| UI/UX v3.0 | Header; IA dan rute (54 layar aktif; PUB-12 dihapus; STU-17/18, ADM-15/16/17 baru); navigasi; flow 3.2, 3.11, 3.12, 3.15; spesifikasi layar; wireframe 5.1–5.3, 5.16, 5.18–5.20; redaksi 9.0 v3.0; matriks 11 dibangkitkan ulang; audit 12 v3.0 | **Gerbang 12.1: 9/9 lolos** (cakupan P0, layar tanpa requirement, rujukan EP/FR, klaim "soal asli", CTA gratis) |

### 10.4 Kode

| Area | Perubahan | Berkas |
|---|---|---|
| Database | Migrasi **0006**: `exam_type` hanya `FULL_TRYOUT`; `exam_series.exam_date`; paket di `products`; `package_grants`; entitlement `PACKAGE`; `referrals`, `vouchers`, `users.referral_code`; `universities`, `study_programs` (acuan wajib bersumber), `student_targets`; `topic_guides`, `study_plans`, `study_plan_items`; simulator pembayaran | `db/migrations/0006_v3_packages_roadmap.sql`, `scripts/verify-migration-v3.mjs` |
| Seed | Musim contoh "Try Out SNBT 2027" (tanggal SNBT **contoh pengembangan**), 3 periode Full Try Out, 3 paket, 5 kampus tanpa skor acuan, panduan materi contoh | `db/seed/seed.mjs` |
| API | Modul baru Commerce (paket, order, simulator, penukaran, kedaluwarsa), Referral, Targets, StudyPlanner; katalog per periode; klaim gratis dan harga per exam dihapus; laporan satu tingkat; roadmap dibangun setelah analisis | `apps/api/src/growth/*`, `catalog/catalog.ts`, `content/exams.ts`, `pi/performance-intelligence.ts` |
| Web | Beranda (9.0.1), `/paket`, katalog periode, detail periode + dialog kredit, onboarding 2 langkah (target), Ringkasan, Try Out, Roadmap, Panduan Materi, Progres & target, Referral, Checkout + simulator, Transaksi; admin Musim, Paket, Data Kampus, Panduan Materi; `/bandingkan`→`/paket`, `/app/rekomendasi`→`/app/roadmap` | `apps/web/src/app/**`, `components/marketing.tsx`, `target-form.tsx`, `planner.tsx` |

### 10.5 Verifikasi yang dijalankan

- `verify-migration-v3.mjs` pada data v2.0 (dalam transaksi yang di-rollback): 7 exam → `FULL_TRYOUT`, product per exam nonaktif, 60 tabel, 4 constraint kunci menolak data tidak valid.
- `db.mjs reset` (migrasi 0001–0006 + seed) berhasil; `tsc --noEmit` lolos untuk API dan web.
- **Uji asap pada DB segar, seluruhnya lolos:** `smoke.mjs` (57 pemeriksaan: paket dan harga, Lifetime H-7, target dan validasinya, order, simulator, idempotensi pembayaran, penukaran kredit termasuk bersamaan, Lifetime ganda ditolak, ujian PER_SECTION, perubahan jawaban, laporan satu tingkat, bukti tanpa kunci, roadmap: prioritas, 3 topik/minggu saat selisih > 150, menit harian, determinisme, tugas DONE tetap; referral: kode tidak valid, 2 vs 3 pembeli, voucher 20%, voucher terkunci lalu kembali setelah order kedaluwarsa), `smoke-content.mjs` (40), `smoke-timeout.mjs` (7).
- **Browser (desktop 1280 dan 375 px):** daftar dengan tautan referral → onboarding profil → target (ITB, Teknik Informatika, "Data acuan belum tersedia", target 650, 90 menit) → Ringkasan kosong → `/paket` → Checkout → simulator → 4 kredit → Try Out → dialog "Pakai 1 kredit? 4 → 3" → instruksi ujian; Roadmap, Progres dengan garis target, Referral, admin Paket/Kampus/Materi/Musim. Tanpa gulir horizontal di 375 px.

### 10.6 Belum dikerjakan / belum terverifikasi

- **Payment gateway produksi belum ada** (OQ-T1). Pembayaran hanya lewat simulator pengembangan yang dijaga `NODE_ENV` + pengaturan; **wajib dimatikan sebelum produksi** (TD-12).
- Tanggal SNBT 2027 dan jadwal periode belum resmi (OQ-25); seed memakai tanggal contoh.
- Sumber "soal asli" (OQ-19) dan data acuan kampus (OQ-20) belum ada; perbedaan skema paket (OQ-22) belum diputuskan.
- Belum ada: grant paket oleh admin lewat UI (FR-PKG-07, P1), refund dan diskualifikasi referral (FR-PAY-09, P1), email voucher terkirim ke penyedia nyata (masih outbox pengembangan), pengingat plan harian (P1), konten SKD.
- Aturan PI yang belum terpicu data uji (lihat 9.3) tetap belum teruji khusus.
- Belum di-commit.
