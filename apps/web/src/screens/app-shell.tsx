import { BookOpen, Clock } from 'lucide-react';
import { Navigate, NavLink, Outlet, useLocation, useMatch } from 'react-router';

import { useLiveGameUpdates } from '../game/live-updates.ts';
import { useSession } from '../session/session.tsx';
import { cn } from '../ui/class-names.ts';
import { Loading } from './load-states.tsx';

// The characters' tab: a rounded face, as the design draws it.
function FacesIcon({ size }: { readonly size: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="6" />
      <circle cx="9.5" cy="11" r="1.2" />
      <circle cx="14.5" cy="11" r="1.2" />
      <path d="M9.5 15.5q2.5 2 5 0" />
    </svg>
  );
}

const tabs = [
  { to: '/', label: 'Hoy', Icon: Clock, end: true },
  { to: '/capitulos', label: 'Capítulos', Icon: BookOpen, end: true },
  { to: '/personajes', label: 'Personajes', Icon: FacesIcon, end: true },
] as const;

/**
 * The signed-in frame: one phone-width column, centred on a desktop, and the floating tabs within
 * thumb's reach. A chapter is read without them.
 */
export function AppShell() {
  const session = useSession();
  const location = useLocation();
  const reading = useMatch('/capitulos/:day') !== null;
  useLiveGameUpdates(session.status === 'signed_in');

  if (session.status === 'loading') return <Loading />;
  if (session.status === 'signed_out') {
    // Back here after signing in, so a shared link to a chapter still opens it.
    return <Navigate to="/entrar" state={location.pathname} replace />;
  }

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col overflow-x-clip">
      <main className={cn('flex-1', !reading && 'pb-[calc(120px+env(safe-area-inset-bottom))]')}>
        {/* A new player gets fresh screens: no form text or state from whoever was here before. */}
        <Outlet key={session.session.user.id} />
      </main>
      {!reading && (
        <nav
          aria-label="Secciones"
          className="nav-pill fixed bottom-[calc(22px+env(safe-area-inset-bottom))] left-1/2 z-20 flex w-[300px] -translate-x-1/2 gap-1 rounded-full p-1.5"
        >
          {tabs.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  'flex h-12 items-center justify-center gap-1.5 rounded-full text-sm font-bold',
                  isActive ? 'flex-1 bg-paper text-sticker-ink' : 'w-16 text-nav-idle',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={isActive ? 18 : 20} />
                  {isActive && <span aria-hidden>{label}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
