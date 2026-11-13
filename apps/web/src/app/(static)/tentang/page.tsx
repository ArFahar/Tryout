export const metadata = { title: 'Tentang' };

/** PUB-02 About */
export default function About() {
  return (
    <>
      <h1 className="text-[32px] font-bold leading-[38px] text-neutral-800">Tentang Cogniverse</h1>
      <p>Cogniverse adalah platform try out SNBT yang membantu siswa mengetahui posisinya dan memutuskan apa yang perlu dipelajari berikutnya.</p>
      <p>Setiap ujian dinilai otomatis per subtes dan per topik. Hasilnya disertai pembahasan setiap soal, sehingga kamu tidak hanya tahu skor, tetapi juga alasan di balik jawaban yang benar.</p>
      <h2 className="pt-4 text-2xl font-bold text-neutral-800">Tentang skor</h2>
      <p>Skor Cogniverse adalah estimasi internal pada skala 0–1000 per subtes. Skor ini tidak memakai metode penilaian resmi SNBT dan bukan prediksi kelulusan.</p>
    </>
  );
}
