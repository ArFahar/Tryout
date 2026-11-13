'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { MeUser, Role } from '@cogniverse/contracts';
import { api, ApiError } from './api';

type Me = MeUser & { studentProfile?: any };
interface Ctx { me: Me | null; loading: boolean; reload: () => Promise<Me | null>; logout: () => Promise<void> }
const SessionCtx = createContext<Ctx>({ me: null, loading: true, reload: async () => null, logout: async () => {} });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      const r = await api<{ user: MeUser; studentProfile: any }>('/users/me');
      const m = { ...r.user, studentProfile: r.studentProfile };
      setMe(m);
      return m;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setMe(null);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return <SessionCtx.Provider value={{ me, loading, reload, logout }}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);

const STAFF: Role[] = ['CONTENT_EDITOR', 'EXAM_ADMIN', 'SUPER_ADMIN'];
/** Halaman pendaratan setelah login per role (UI/UX 2.3 catatan IA). */
export function homeFor(me: Me) {
  if (me.roles.includes('STUDENT')) return me.profileComplete && me.hasTarget ? '/app' : '/app/onboarding';
  if (me.roles.includes('EXAM_ADMIN') || me.roles.includes('SUPER_ADMIN')) return '/admin/exam';
  if (me.roles.includes('CONTENT_EDITOR')) return '/admin/review';
  if (me.roles.includes('CONTRIBUTOR')) return '/kontributor';
  return '/';
}
export const isStaff = (me: Me | null) => !!me && me.roles.some((r) => STAFF.includes(r));

/** Penjaga sisi klien; otorisasi sebenarnya ditegakkan API. */
export function useRequireRole(roles: Role[]) {
  const { me, loading } = useSession();
  const router = useRouter();
  const path = usePathname();
  const allowed = !!me && (me.roles.includes('SUPER_ADMIN') || roles.some((r) => me.roles.includes(r)));
  useEffect(() => {
    if (loading) return;
    if (!me) router.replace(`/masuk?lanjut=${encodeURIComponent(path)}`);
  }, [loading, me, router, path]);
  return { me, ready: !loading && allowed, denied: !loading && !!me && !allowed };
}
