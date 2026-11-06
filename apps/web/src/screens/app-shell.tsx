import { BookOpen, Sunrise, Users } from 'lucide-react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';

import { useLiveGameUpdates } from '../game/live-updates.ts';
import { useSession } from '../session/session.tsx';
import { cn } from '../ui/class-names.ts';
import { Loading } from './load-states.tsx';

const tabs = [
  { to: '/', label: 'Hoy', icon: Sunrise, end: true },
  { to: '/capitulos', label: 'Capítulos', icon: BookOpen, end: false },
  { to: '/personajes', label: 'Personajes', icon: Users, end: false },
] as const;

/** The signed-in frame: the name at the top, the screens, and the tabs within thumb's reach. */
export function AppShell() {
  const session = useSession();
  const location = useLocation();
  useLiveGameUpdates(session.status === 'signed_in');

  if (session.status === 'loading') return <Loading />;
  if (session.status === 'signed_out') {
    // Back here after signing in, so a shared link to a chapter still opens it.
    return <Navigate to="/entrar" state={location.pathname} replace />;
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
        <Link to="/" className="font-serif text-lg font-semibold tracking-tight text-ink">
          Cronista
        </Link>
      </header>
      <main className="flex-1 px-5 pb-28">
        {/* A new player gets fresh screens: no form text or state from whoever was here before. */}
        <Outlet key={session.session.user.id} />
      </main>
      <nav
        aria-label="Secciones"
        className="fixed inset-x-0 bottom-0 border-t border-rule bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <ul className="mx-auto flex max-w-xl">
          {tabs.map(({ to, label, icon: Icon, end }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs',
                    isActive ? 'text-pen' : 'text-muted',
                  )
                }
              >
                <Icon aria-hidden size={20} strokeWidth={1.75} />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
