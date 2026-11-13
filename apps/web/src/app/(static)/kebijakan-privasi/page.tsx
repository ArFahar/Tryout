export const metadata = { title: 'Kebijakan Privasi' };

/** PUB-11. Isi resmi menunggu tinjauan hukum (UU PDP, OQ-08). */
export default function Privacy() {
  return (
    <>
      <h1 className="text-[32px] font-bold leading-[38px] text-neutral-800">Kebijakan Privasi</h1>
      <p className="text-sm text-neutral-600">Versi 2026-11</p>
      <div role="note" className="rounded-md border-l-4 border-secondary-500 bg-secondary-50 px-4 py-3 text-sm text-secondary-700">
        Draf untuk pengembangan. Teks resmi menunggu tinjauan penasihat hukum terkait UU Pelindungan Data Pribadi.
      </div>
      <h2 className="pt-2 text-xl font-bold text-neutral-800">Data yang kami simpan</h2>
      <p>Nama, email, status siswa, asal sekolah, tahun lulus, provinsi, nomor telepon (opsional), serta jawaban dan hasil ujianmu.</p>
      <h2 className="pt-2 text-xl font-bold text-neutral-800">Untuk apa</h2>
      <p>Untuk menjalankan ujian, menghitung skor, menampilkan laporan, dan mengirim email terkait akun serta hasil ujian.</p>
    </>
  );
}
