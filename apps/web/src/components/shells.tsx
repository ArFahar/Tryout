'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Role } from '@cogniverse/contracts';
import { Alert, Button, ButtonLink, Logo, LoadingBlock, cx } from './ui';
import { homeFor, useRequireRole, useSession } from '@/lib/session';
import { api } from '@/lib/api';

export function SkipLink() {
  return (
    <a href="#konten" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow-md">
      Lewati ke konten utama
    </a>
  );
}

// ------------------------------------------------------------- Publik
export function PublicHeader() {
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const links = [{ href: '/katalog', label: 'Try Out' }, { href: '/paket', label: 'Paket' }, { href: '/tentang', label: 'Tentang' }];
  return (
    <header className="material-bar sticky top-0 z-30 border-b border-black/5">
      <div className="mx-auto flex h-[52px] max-w-[1024px] items-center justify-between gap-4 px-5 md:h-12">
        <Link href="/" aria-label="Cogniverse — beranda"><Logo /></Link>
        <nav aria-label="Utama" className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={path.startsWith(l.href) ? 'page' : undefined}
              className={cx('text-callout text-neutral-700 hover:text-neutral-900', path.startsWith(l.href) && 'font-semibold text-neutral-900')}>{l.label}</Link>
          ))}
        </nav>
        <div className="hidden items-center gap-4 md:flex">
          {me ? <ButtonLink href={homeFor(me)} size="sm">Buka Ringkasan</ButtonLink> : (
            <>
              <Link href="/masuk" className="text-callout text-neutral-700 hover:text-neutral-900">Masuk</Link>
              <ButtonLink href="/daftar" size="sm">Daftar Gratis</ButtonLink>
            </>
          )}
        </div>
        <button className="rounded-md p-2 md:hidden" aria-expanded={open} aria-controls="menu-publik" onClick={() => setOpen(!open)} aria-label="Menu">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" /></svg>
        </button>
      </div>
      {open && (
        <nav id="menu-publik" aria-label="Utama" className="h-[calc(100dvh-52px)] bg-white px-5 py-4 md:hidden">
          <ul className="space-y-1">
            {links.map((l) => <li key={l.href}><Link href={l.href} onClick={() => setOpen(false)} className="block py-3 text-title-3 font-semibold">{l.label}</Link></li>)}
            {me ? <li><Link href={homeFor(me)} className="block py-3 text-title-3 font-semibold text-link">Buka Ringkasan</Link></li> : (
              <>
                <li><Link href="/masuk" className="block py-3 text-title-3 font-semibold">Masuk</Link></li>
                <li><ButtonLink href="/daftar" size="lg" className="mt-4 w-full">Daftar Gratis</ButtonLink></li>
              </>
            )}
          </ul>
        </nav>
      )}
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="bg-neutral-50 text-footnote text-neutral-600">
      <div className="mx-auto max-w-[1024px] px-5 py-10">
        <p className="border-b border-neutral-200 pb-4">
          Skor Cogniverse adalah estimasi internal pada skala 0–1000, tidak memakai metode penilaian resmi SNBT, dan bukan prediksi kelulusan.
        </p>
        <div className="grid gap-6 pt-6 sm:grid-cols-3">
          <div>
            <p className="font-semibold text-neutral-900">Cogniverse</p>
            <p className="mt-1">Full Try Out SNBT untuk kelas 12, dengan roadmap belajar menuju kampus tujuan.</p>
          </div>
          <nav aria-label="Tautan footer">
            <ul className="space-y-2">
              <li><Link href="/katalog" className="hover:underline">Try Out</Link></li>
              <li><Link href="/paket" className="hover:underline">Paket & Harga</Link></li>
              <li><Link href="/tentang" className="hover:underline">Tentang</Link></li>
            </ul>
          </nav>
          <nav aria-label="Dokumen hukum">
            <ul className="space-y-2">
              <li><Link href="/syarat-ketentuan" className="hover:underline">Syarat &amp; Ketentuan</Link></li>
              <li><Link href="/kebijakan-privasi" className="hover:underline">Kebijakan Privasi</Link></li>
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}

/** `bleed`: halaman mengatur pita bagian sendiri (beranda, bandingkan). */
export function PublicShell({ children, narrow, bleed }: { children: React.ReactNode; narrow?: boolean; bleed?: boolean }) {
  return (
    <div className="bg-white">
      <SkipLink />
      <PublicHeader />
      {bleed ? <main id="konten">{children}</main> : (
        <main id="konten" className={cx('mx-auto px-5 py-10 md:py-14', narrow ? 'max-w-[480px]' : 'max-w-[1200px]')}>{children}</main>
      )}
      <PublicFooter />
    </div>
  );
}

// ------------------------------------------------------------- Banner verifikasi email
function VerifyBanner() {
  const { me } = useSession();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  if (!me || me.emailVerified || !me.roles.includes('STUDENT')) return null;
  return (
    <div className="bg-warning-50 px-5 py-2.5 text-callout text-warning-700" role="status">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-3 gap-y-1">
        <span>Verifikasi email kamu ({me.email}) untuk mengklaim ujian.</span>
        <button className="font-medium underline underline-offset-2" disabled={state === 'sending'}
          onClick={async () => {
            setState('sending');
            try { await api('/auth/verify-email/resend', { method: 'POST' }); setState('sent'); setMsg('Email verifikasi sudah dikirim ulang.'); }
            catch (e: any) { setState('error'); setMsg(e.message); }
          }}>Kirim ulang email</button>
        {msg && <span>{msg}</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Siswa (STU)
// UI/UX 2.4: Ringkasan · Try Out · Asesmen Saya · Progres · Riwayat (mobile: 4 tab, tanpa Progres)
const STUDENT_NAV = [
  { href: '/app', label: 'Ringkasan', short: 'Ringkasan', icon: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z', mobile: true },
  { href: '/app/tryout', label: 'Try Out', short: 'Try Out', icon: 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z', mobile: true },
  { href: '/app/roadmap', label: 'Roadmap', short: 'Roadmap', icon: 'M4 6h10M4 12h16M4 18h7M17 4l3 2-3 2M14 16l3 2-3 2', mobile: true },
  { href: '/app/progres', label: 'Progres', short: 'Progres', icon: 'M4 19h16M6 15l4-4 3 3 5-6', mobile: true },
  { href: '/app/asesmen', label: 'Asesmen Saya', short: 'Asesmen', icon: 'M6 3h12v18H6zM9 7h6M9 11h6M9 15h4', mobile: false },
];

function AccountMenu() {
  const { me, logout } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!me) return null;
  const initials = me.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={`Menu akun ${me.fullName}`}
        className="flex h-10 items-center gap-2 rounded-full pl-1 pr-3 hover:bg-black/5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-50 text-footnote font-semibold text-primary-800" aria-hidden="true">{initials}</span>
        <span className="hidden max-w-40 truncate text-callout sm:inline">{me.fullName}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-40 w-60 rounded-lg bg-white p-1.5 shadow-md"
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <p className="truncate px-3 py-2 text-footnote text-neutral-600">{me.email}</p>
          {me.roles.includes('STUDENT') && <>
            <Link role="menuitem" href="/app/profil" className="block rounded-sm px-3 py-2 text-callout hover:bg-neutral-50" onClick={() => setOpen(false)}>Profil</Link>
            {[['/app/asesmen', 'Asesmen Saya'], ['/app/referral', 'Referral'], ['/app/transaksi', 'Transaksi'], ['/app/riwayat', 'Riwayat']].map(([h, l]) => (
              <Link key={h} role="menuitem" href={h} className="block rounded-sm px-3 py-2 text-callout hover:bg-neutral-50" onClick={() => setOpen(false)}>{l}</Link>
            ))}
          </>}
          <button role="menuitem" className="block w-full rounded-sm px-3 py-2 text-left text-callout hover:bg-neutral-50"
            onClick={async () => { await logout(); router.replace('/masuk'); }}>Keluar</button>
        </div>
      )}
    </div>
  );
}

export function StudentShell({ children }: { children: React.ReactNode }) {
  const { me, ready, denied } = useRequireRole(['STUDENT']);
  const path = usePathname();
  const allowIncompleteProfile = path.startsWith('/app/onboarding') || path.startsWith('/app/profil');
  // v3.0 UJ-01: profil dan target kampus & jurusan wajib sebelum memakai aplikasi
  const router = useRouter();
  const needOnboarding = !!(ready && me && (!me.profileComplete || !me.hasTarget) && !allowIncompleteProfile);
  useEffect(() => { if (needOnboarding) router.replace('/app/onboarding'); }, [needOnboarding, router]);
  if (needOnboarding) return null;
  const active = (href: string) => (href === '/app' ? path === '/app' : path.startsWith(href));
  return (
    <>
      <SkipLink />
      <header className="material-bar sticky top-0 z-30 border-b border-black/5">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-4 px-5">
          <Link href="/app" aria-label="Cogniverse — ringkasan"><Logo /></Link>
          <nav aria-label="Utama" className="hidden items-center gap-1 md:flex">
            {STUDENT_NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined}
                className={cx('rounded-full px-3.5 py-1.5 text-callout', active(n.href) ? 'bg-neutral-900 font-semibold text-white' : 'text-neutral-700 hover:text-neutral-900')}>
                {n.label}
              </Link>
            ))}
          </nav>
          <AccountMenu />
        </div>
      </header>
      <VerifyBanner />
      <main id="konten" className="mx-auto max-w-[1200px] px-5 pb-28 pt-8 md:pb-16 md:pt-10">
        {denied ? <Alert tone="danger" title="Akses ditolak">Halaman ini khusus untuk siswa.</Alert> : ready ? children : <LoadingBlock />}
      </main>
      <nav aria-label="Utama" className="material-bar fixed inset-x-0 bottom-0 z-30 border-t border-black/5 pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="grid h-[50px] grid-cols-4">
          {STUDENT_NAV.filter((n) => n.mobile).map((n) => (
            <li key={n.href}>
              <Link href={n.href} aria-current={active(n.href) ? 'page' : undefined}
                className={cx('flex h-full flex-col items-center justify-center gap-0.5 text-[11px]', active(n.href) ? 'font-semibold text-primary-600' : 'text-neutral-600')}>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={n.icon} /></svg>
                {n.short}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

// ------------------------------------------------------------- Admin & kontributor
type NavItem = { href: string; label: string; roles: Role[] };
const ADMIN_NAV: NavItem[] = [
  { href: '/admin/exam', label: 'Ujian', roles: ['EXAM_ADMIN'] },
  { href: '/admin/seri', label: 'Musim', roles: ['EXAM_ADMIN'] },
  { href: '/admin/paket', label: 'Paket', roles: ['EXAM_ADMIN'] },
  { href: '/admin/kampus', label: 'Data Kampus', roles: ['EXAM_ADMIN'] },
  { href: '/admin/soal', label: 'Bank Soal', roles: ['CONTENT_EDITOR', 'EXAM_ADMIN'] },
  { href: '/admin/review', label: 'Review Soal', roles: ['CONTENT_EDITOR'] },
  { href: '/admin/materi', label: 'Panduan Materi', roles: ['CONTENT_EDITOR'] },
  { href: '/kontributor', label: 'Soal Saya', roles: ['CONTRIBUTOR'] },
];

export function StaffShell({ children, roles }: { children: React.ReactNode; roles: Role[] }) {
  const { me, ready, denied } = useRequireRole(roles);
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const items = ADMIN_NAV.filter((n) => me && (me.roles.includes('SUPER_ADMIN') ? n.href !== '/kontributor' : n.roles.some((r) => me.roles.includes(r))));
  const nav = (
    <ul className="space-y-1">
      {items.map((n) => {
        const act = path.startsWith(n.href);
        return (
          <li key={n.href}>
            <Link href={n.href} aria-current={act ? 'page' : undefined} onClick={() => setOpen(false)}
              className={cx('flex items-center rounded-md px-3 py-2.5 text-callout', act ? 'bg-primary-50 font-semibold text-primary-800' : 'text-neutral-700 hover:bg-neutral-100')}>
              {n.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
  return (
    <div className="min-h-screen bg-white">
      <SkipLink />
      <header className="material-bar sticky top-0 z-30 flex h-14 items-center justify-between border-b border-black/5 px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <button className="rounded-md p-2 lg:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" /></svg>
          </button>
          <Link href="/" aria-label="Cogniverse"><Logo /></Link>
          <span className="hidden rounded-full bg-neutral-100 px-2.5 py-0.5 text-caption font-semibold text-neutral-700 sm:inline">
            {me?.roles.map((r) => ({ CONTENT_EDITOR: 'Content Editor', EXAM_ADMIN: 'Exam Admin', SUPER_ADMIN: 'Super Admin', CONTRIBUTOR: 'Kontributor', STUDENT: 'Siswa' })[r]).join(', ')}
          </span>
        </div>
        <AccountMenu />
      </header>
      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 bg-neutral-50 p-3 lg:block">
          <nav aria-label="Menu admin">{nav}</nav>
        </aside>
        {open && <div className="fixed inset-0 top-14 z-20 bg-white p-3 lg:hidden"><nav aria-label="Menu admin">{nav}</nav></div>}
        <main id="konten" className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto max-w-[1440px]">
            {denied ? <Alert tone="danger" title="Akses ditolak">Anda tidak memiliki akses ke halaman ini.</Alert> : ready ? children : <LoadingBlock />}
          </div>
        </main>
      </div>
    </div>
  );
}

export function SubmitRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 pt-2">{children}</div>;
}
export { Button };
