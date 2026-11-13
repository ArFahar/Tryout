# Cogniverse Assessment Platform

Implementasi tonggak pertama dari blueprint Cogniverse (PRD v1.0, TDD v1.0, UI/UX Specification v1.1), mengikuti urutan pengerjaan UI/UX Bagian 13.5 langkah 1–3: **fondasi, konten, exam dan engine**. Pada tonggak ini **Diagnostic gratis sudah dapat dijalankan end-to-end**.

## Menjalankan secara lokal

Prasyarat: Node.js ≥ 20 dan pnpm 9. Docker tidak diperlukan; PostgreSQL 16 dijalankan sebagai binary embedded dari npm (`embedded-postgres`).

```bash
pnpm install
pnpm build:contracts
pnpm db:reset          # initdb (sekali), migrasi db/migrations, lalu data contoh
pnpm db:start          # biarkan berjalan di terminal sendiri (port 54329)
pnpm dev:api           # http://localhost:4000/api/v1
pnpm dev:web           # http://localhost:3000
```

Web memproksi `/api/*` ke API sehingga cookie sesi berada pada satu origin (TDD 5.1).

### Akun contoh (hanya untuk pengembangan)

Semua akun memakai kata sandi `Cogniverse#2026`, dibuat oleh `db/seed/seed.mjs`.

| Email | Role | Halaman awal |
|---|---|---|
| `siswa@cogniverse.test` | Student (email terverifikasi, profil lengkap) | `/app` |
| `tutor@cogniverse.test` | Contributor | `/kontributor` |
| `editor@cogniverse.test` | Content Editor | `/admin/review` |
| `admin@cogniverse.test` | Exam Admin | `/admin/exam` |
| `superadmin@cogniverse.test` | Super Admin | `/admin/exam` |

Email transaksional (verifikasi, reset kata sandi) tidak benar-benar dikirim; isinya dapat dibuka di `http://localhost:3000/dev/outbox`.

Data contoh berisi 7 subtes SNBT dengan topiknya, 21 soal yang ditulis khusus untuk seed ini (sudah melalui alur review), serta dua ujian gratis: **Diagnostic Test SNBT** (timer total, 21 soal) dan **Mini Try Out — Timer per Subtes** (2 subtes × 4 menit).

### Pengujian

```bash
pnpm db:reset && pnpm smoke     # API harus berjalan
```

`pnpm smoke` menjalankan tiga skrip uji end-to-end terhadap API (63 pemeriksaan). Jalankan setelah `db:reset`, karena akun siswa contoh hanya dapat mengerjakan Diagnostic satu kali.

- `scripts/smoke.mjs`: login, klaim, mulai bersamaan (EC-05), sesi diambil alih (BR-LIF-04), kunci tidak bocor (FR-ENG-11), autosave dan permintaan usang (BR-SUB-05), submit idempoten, hasil, pembahasan, alur PER_SECTION.
- `scripts/smoke-content.mjs`: draf kontributor, kelengkapan sebelum review (BR-QV-08), sanitasi HTML, pemisahan tugas review, versi baru, exam builder, validasi publikasi, penguncian struktur, tarik dari katalog.
- `scripts/smoke-timeout.mjs`: rekonsiliasi subtes tepat pada tenggat (BR-TMO-05), penolakan jawaban terlambat, auto-submit oleh sweeper (BR-TMO-04).

## Struktur

```
apps/api         NestJS 11: modul Identity, Catalog/Entitlement, ExamEngine, Scoring, QuestionBank/Review, ExamManagement, Notification
apps/web         Next.js 15 (App Router) + Tailwind CSS 4, token design system UI/UX v1.1
packages/contracts  Skema Zod dan tipe bersama
db/migrations    0001–0003 diambil apa adanya dari TDD 3.5–3.7; 0004 roles (TDD 3.8)
db/seed          Data contoh pengembangan
scripts          Pengelola database lokal dan uji asap
```

## Cakupan tonggak ini

| Area | Sudah | Rujukan |
|---|---|---|
| Identity | Registrasi + persetujuan S&K, verifikasi email, login dengan penguncian bertahap, refresh token berotasi dengan deteksi pemakaian ulang, logout, lupa/atur ulang kata sandi, profil siswa | EP-AUTH-01..08, EP-USR-01/03 |
| Katalog & entitlement | Katalog publik, detail ujian dengan status kepemilikan, klaim gratis idempoten, "Ujian Saya" | EP-EXM-01/02, EP-ENT-01/02 |
| Exam engine | Kelayakan mulai, mulai/lanjut sebagai satu pintu, snapshot soal, simpan jawaban satu pernyataan SQL, batch, akhiri subtes, submit, rekonsiliasi PER_SECTION, sweeper auto-submit | EP-ATT-01..07, EP-ANS-01/02, TDD 6.1–6.3 |
| Scoring & hasil | Skor per subtes dan total dengan NUMERIC PostgreSQL, akurasi, klasifikasi topik, hasil, pembahasan dengan filter | EP-RES-01/02, TDD 6.5.1 |
| Bank soal & review | Daftar dengan filter, editor dengan pratinjau dan rumus, versi baru, retire, ajukan/tarik, antrean, keputusan dengan catatan | EP-QST-01, 06–13, EP-REV-01..05 |
| Exam builder | Buat, pengaturan, subtes, pemilih soal yang disetujui, validasi publikasi (dry run), terbit, tarik | EP-EXM-03..10, 13 |
| Antarmuka | PUB-01..03, 04, 06..09, 11; STU-01..03, 05..11; ADM-03..07; CTR-01, 02; SYS-01 | UI/UX Bagian 4–5 |

### Belum dibangun (tonggak berikutnya, UI/UX 13.5 langkah 4–6)

- **Commerce**: order, Midtrans, webhook, ujian berbayar. Harga selain 0 ditolak dengan pesan yang jelas.
- **Sesi terjadwal**: session, enrollment, seat hold, publikasi hasil terjadwal. Cabang engine untuk `SCHEDULED` saat ini menolak dengan `NOT_ENROLLED`.
- **Penguatan**: koreksi kunci dan rescoring, intervensi attempt, manajemen pengguna/hasil/pembayaran (ADM-02, 08–11), ekspor CSV.
- Undangan staf (PUB-10), ganti email/kata sandi dari profil, unggah gambar soal (EP-QST-14/15), pengaturan taksonomi (ADM-13).
- Uji Playwright, uji beban k6, CI/CD, observabilitas.

## Penyimpangan dari TDD (sementara, untuk pengembangan lokal)

| TDD | Implementasi sekarang | Alasan dan langkah lanjut |
|---|---|---|
| PostgreSQL di Docker/terkelola | PostgreSQL 16 embedded via npm | Docker Desktop tidak dapat berjalan di mesin pengembang. Produksi tetap PostgreSQL terkelola |
| Redis + BullMQ (pekerjaan tertunda, rate limit, daftar cabut token) | Sweeper 15 detik di proses API; rate limit dan daftar cabut di memori | Sweeper memang jaring pengaman di TDD 6.3.4 dan cukup untuk target ≤ 60 detik. Wajib Redis sebelum lebih dari satu instance API |
| Prisma + SQL mentah (OQ-T4) | `pg` dengan SQL berparameter saja | Jalur kritis memang SQL mentah; OQ-T4 masih terbuka |
| Turborepo | Skrip pnpm workspace | Belum diperlukan |
| TanStack Query, IndexedDB | `fetch` sederhana; antrean jawaban offline di `localStorage` | Perilaku antrean sama (clientSeq, kirim ulang saat online); dapat dipindah ke IndexedDB |
| Rich text editor | Area teks dengan paragraf, tag dasar, dan rumus `\( \)`, plus pratinjau langsung | Editor WYSIWYG menyusul |
| MailerPort ke penyedia email (OQ-T3) | DevMailer + `/dev/outbox` | Penyedia belum dipilih |
| Klasifikasi topik "Cukup" | Enum `ADEQUATE` | Dokumen hanya menyebut "(di antara)" |

## Verifikasi terhadap blueprint

- DDL TDD 3.5–3.7 berjalan di PostgreSQL 16 **tanpa perubahan**, termasuk constraint, index parsial, dan trigger immutability. Seed melewati trigger alur review (DRAFT → IN_REVIEW → APPROVED oleh pengguna lain).
- Contoh perhitungan PRD 8.12 (TC-SCR-01) belum dibuat sebagai uji otomatis tersendiri. Rumus yang sama diuji lewat smoke test.
- Waktu per soal (FR-ENG-14) baru terkirim saat jawaban disimpan; waktu melihat soal tanpa mengubah jawaban belum tercatat.
