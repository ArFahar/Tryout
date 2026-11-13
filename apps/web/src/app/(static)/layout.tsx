import { PublicShell } from '@/components/shells';

export default function StaticLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell><article className="mx-auto max-w-[720px] space-y-4 text-neutral-700">{children}</article></PublicShell>;
}
