import { StaffShell } from '@/components/shells';

export default function ContributorLayout({ children }: { children: React.ReactNode }) {
  return <StaffShell roles={['CONTRIBUTOR']}>{children}</StaffShell>;
}
