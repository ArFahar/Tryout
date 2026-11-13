'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PublicShell } from '@/components/shells';
import { ButtonLink, ProgressBar } from '@/components/ui';
import { PackageCards, SampleRoadmap } from '@/components/marketing';
import { api } from '@/lib/api';
import type { PackagesResponse } from '@/lib/catalog';

/** PUB-01 Beranda — redaksi UI/UX v3.0 9.0.1 (judul A, CTA A). Harga dan tanggal dibaca dari EP-PKG-01. */
export default function Home() {
  const [pk, setPk] = useState<PackagesResponse | null | 'error'>(null);
  useEffect(() => { api<PackagesResponse>('/packages').then(setPk).catch(() => setPk('error')); }, []);

  return (
    <PublicShell bleed>
      {/* Hero */}
      <section className="px-5 pb-16 pt-16 text-center md:pb-24 md:pt-24">
        <p className="text-headline font-semibold text-primary-600">Persiapan SNBT untuk kelas 12</p>
        <h1 className="mx-auto mt-3 max-w-3xl text-[36px]/10 font-bold tracking-[-0.015em] text-neutral-900 md:text-display">
          Try out SNBT yang berubah jadi rencana belajar.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-body text-neutral-600 md:text-[21px] md:leading-[30px]">
          Kerjakan Full Try Out, lalu dapatkan analisis kelemahan dan kelebihanmu, roadmap belajar sampai hari ujian, plan harian, dan jarak skormu ke target kampus dan jurusan.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6">
          <ButtonLink href="/daftar" size="lg">Daftar Gratis</ButtonLink>
          <ButtonLink href="/paket" variant="link">Lihat paket</ButtonLink>
        </div>

        {/* Contoh: komponen asli dengan data ilustrasi berlabel (6.8) */}
        <div className="mx-auto mt-14 grid max-w-[980px] gap-6 text-left md:grid-cols-2">
          <div className="rounded-xl bg-neutral-50 p-6 md:p-8" aria-label="Contoh laporan hasil">
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-full bg-neutral-200 px-2.5 py-0.5 text-caption font-semibold uppercase text-neutral-700">Contoh laporan</span>
              <span className="text-footnote text-neutral-600">Data ilustrasi</span>
            </div>
            <p className="mt-5 text-footnote text-neutral-600">Skor total · target 700</p>
            <p className="tabular text-title-1 font-bold">612<span className="text-body font-normal text-neutral-600"> dari 1000</span></p>
            <ul className="mt-4 space-y-3 text-callout">
              {[['Penalaran Umum', 640], ['Pengetahuan Kuantitatif', 480]].map(([n, v]) => (
                <li key={n as string}>
                  <div className="mb-1 flex justify-between"><span>{n}</span><span className="tabular font-semibold">{v}</span></div>
                  <ProgressBar value={v as number} max={1000} />
                </li>
              ))}
            </ul>
            <div className="mt-4 rounded-lg bg-white p-4">
              <p className="text-caption font-semibold uppercase text-neutral-600">Pengamatan</p>
              <p className="mt-1">Di Statistika, <strong>1 dari 4</strong> soal benar.</p>
            </div>
          </div>
          <SampleRoadmap />
        </div>
      </section>

      {/* Empat nilai unik */}
      <section className="bg-neutral-50 px-5 py-16 md:py-24" aria-labelledby="nilai">
        <div className="mx-auto max-w-[980px]">
          <h2 id="nilai" className="mx-auto max-w-2xl text-center text-[28px]/8 font-bold md:text-title-1">Empat hal yang kamu dapat setelah setiap try out</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {[
              ['Tahu kelemahan dan kelebihanmu.', 'Topik yang kuat, cukup, dan perlu ditingkatkan — lengkap dengan soal yang jadi buktinya dan ringkasan materi yang perlu kamu pahami.'],
              ['Tahu yang harus dipelajari hari ini.', 'Roadmap per minggu sampai hari SNBT dan daftar tugas harian sesuai waktu belajarmu.'],
              ['Lihat jarakmu ke target.', 'Pilih kampus dan jurusan tujuan, tetapkan target skor, lalu pantau apakah jaraknya mengecil di setiap periode.'],
              ['Latihan dengan pola soal SNBT 2023–2026.', 'Susunan tujuh subtes dan timer per subtes seperti ujian sebenarnya.'],
            ].map(([t, d]) => (
              <div key={t} className="rounded-xl bg-white p-8 md:p-10">
                <p className="text-title-3 font-semibold">{t}</p>
                <p className="mt-2 text-neutral-600">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cara kerja */}
      <section className="px-5 py-16 md:py-24" aria-labelledby="cara-kerja">
        <div className="mx-auto max-w-[980px]">
          <h2 id="cara-kerja" className="text-center text-[28px]/8 font-bold md:text-title-2">Cara kerjanya</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-4">
            {[
              ['Daftar dan pilih target', 'Pilih kampus dan jurusan tujuanmu. Gratis.'],
              ['Pilih paket', 'Mulai Rp35.000 untuk satu periode.'],
              ['Kerjakan try out', 'Full Try Out dengan timer per subtes.'],
              ['Ikuti roadmap', 'Tugas harian dari hasil try out-mu sendiri.'],
            ].map(([t, d], i) => (
              <li key={t} className="rounded-lg bg-neutral-50 p-6">
                <span className="tabular text-title-2 font-bold text-primary-600">{i + 1}</span>
                <p className="mt-3 text-headline font-semibold">{t}</p>
                <p className="mt-1 text-callout text-neutral-600">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Paket */}
      <section className="bg-neutral-50 px-5 py-16 md:py-24" aria-labelledby="paket">
        <div className="mx-auto max-w-[980px]">
          <h2 id="paket" className="text-center text-[28px]/8 font-bold md:text-title-1">Pilih paketmu</h2>
          <div className="mt-10">
            {pk === 'error' ? <p className="text-center text-neutral-600">Harga sedang tidak dapat dimuat.</p>
              : pk === null ? <p className="text-center text-neutral-600">Memuat…</p>
                : <PackageCards data={pk} compact />}
          </div>
          <div className="mx-auto mt-10 max-w-xl rounded-lg bg-white p-6 text-center">
            <p className="text-headline font-semibold">Ajak 3 teman, dapat diskon 20%.</p>
            <p className="mt-1 text-callout text-neutral-600">Voucher terbit setelah ketiga temanmu membeli paket dengan kodemu.</p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-5 py-16 md:py-24" aria-labelledby="faq">
        <div className="mx-auto max-w-[720px]">
          <h2 id="faq" className="text-[28px]/8 font-bold md:text-title-2">Pertanyaan umum</h2>
          <div className="mt-8 divide-y divide-neutral-200 border-y border-neutral-200">
            {[
              ['Apakah skor ini sama dengan skor SNBT?', 'Tidak. Skor Cogniverse adalah estimasi internal pada skala 0–1000, tidak memakai metode penilaian resmi SNBT, dan bukan prediksi kelulusan.'],
              ['Ada try out gratis?', 'Tidak. Daftar, memilih target, contoh laporan, dan kode referral gratis. Try out mulai Rp35.000.'],
              ['Apa bedanya paket 1x, Bundle, dan Lifetime?', 'Isi setiap try out sama. Bedanya jumlah periode yang bisa kamu kerjakan dan masa aksesnya.'],
              ['Dari mana target skor kampus?', 'Target skor kamu tentukan sendiri. Skor acuan kampus hanya kami tampilkan bila ada sumber datanya, dan skalanya berbeda dengan skor Cogniverse.'],
            ].map(([q, a]) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-headline font-semibold">
                  {q}<span aria-hidden="true" className="text-neutral-600 transition-transform group-open:rotate-180">⌄</span>
                </summary>
                <p className="mt-3 text-neutral-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Penutup */}
      <section className="bg-neutral-50 px-5 py-16 text-center md:py-24">
        <h2 className="text-[28px]/8 font-bold md:text-title-1">Mulai dari target, bukan dari tebakan.</h2>
        <div className="mt-8"><ButtonLink href="/daftar" size="lg">Daftar Gratis</ButtonLink></div>
        <p className="mx-auto mt-6 max-w-xl text-footnote text-neutral-600">Sudah punya akun? <Link href="/masuk" className="text-link hover:underline">Masuk</Link></p>
      </section>
    </PublicShell>
  );
}
