export const metadata = { title: 'Syarat & Ketentuan' };

/** PUB-11. Isi resmi menunggu tinjauan hukum (OQ-06, OQ-08). */
export default function Terms() {
  return (
    <>
      <h1 className="text-[32px] font-bold leading-[38px] text-neutral-800">Syarat &amp; Ketentuan</h1>
      <p className="text-sm text-neutral-600">Versi 2026-11</p>
      <div role="note" className="rounded-md border-l-4 border-secondary-500 bg-secondary-50 px-4 py-3 text-sm text-secondary-700">
        Draf untuk pengembangan. Teks resmi menunggu tinjauan penasihat hukum, termasuk kebijakan refund dan ketentuan pengguna di bawah 18 tahun.
      </div>
      <h2 className="pt-2 text-xl font-bold text-neutral-800">Akun</h2>
      <p>Satu akun untuk satu orang. Kamu bertanggung jawab menjaga kerahasiaan kata sandi.</p>
      <h2 className="pt-2 text-xl font-bold text-neutral-800">Ujian</h2>
      <p>Timer ujian dihitung oleh server dan tidak berhenti ketika koneksi terputus, halaman ditutup, atau perangkat berganti. Jawaban yang diterima server setelah waktu habis tidak dinilai.</p>
      <h2 className="pt-2 text-xl font-bold text-neutral-800">Skor</h2>
      <p>Skor adalah estimasi internal Cogniverse, tidak memakai metode penilaian resmi SNBT, dan bukan prediksi kelulusan.</p>
    </>
  );
}
