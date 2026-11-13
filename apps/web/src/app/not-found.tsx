import Link from 'next/link';

/** SYS-01 Tidak Ditemukan */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-medium text-neutral-600">404</p>
      <h1 className="mt-2 text-2xl font-bold">Halaman tidak ditemukan</h1>
      <p className="mt-2 text-neutral-600">Halaman yang kamu cari tidak ada atau sudah dipindahkan.</p>
      <Link href="/" className="mt-6 inline-flex h-12 items-center rounded-md border-[1.5px] border-primary-600 px-6 font-medium text-primary-600 hover:bg-primary-50">Kembali ke Beranda</Link>
    </main>
  );
}
