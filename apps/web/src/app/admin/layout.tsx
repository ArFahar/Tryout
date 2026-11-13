import { StaffShell } from '@/components/shells';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <StaffShell roles={['CONTENT_EDITOR', 'EXAM_ADMIN']}>{children}</StaffShell>;
}
