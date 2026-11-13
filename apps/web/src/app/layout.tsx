import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { SessionProvider } from '@/lib/session';

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Cogniverse — Try out SNBT kelas 12 dengan roadmap belajar', template: '%s · Cogniverse' },
  description: 'Full Try Out SNBT dengan analisis kelemahan, roadmap belajar, plan harian, dan progres menuju target kampus. Mulai Rp35.000.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#ffffff' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={inter.variable}>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
