import { BookOpen, Sunrise, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';

import { useLiveGameUpdates } from '../game/live-updates.ts';
import { useSession } from '../session/session.tsx';
import { cn } from '../ui/class-names.ts';

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
        <Outlet />
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

/** A quiet placeholder while data loads. */
export function Loading({ label = 'Cargando…' }: { readonly label?: ReactNode }) {
  return (
    <p role="status" className="py-16 text-center text-muted">
      {label}
    </p>
  );
}

/** A failed read, with a retry. */
export function LoadFailed({ retry }: { readonly retry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 py-12">
      <p className="text-ink">No se ha podido cargar. Comprueba la conexión.</p>
      <button type="button" className="font-medium text-pen" onClick={retry}>
        Reintentar
      </button>
    </div>
  );
}
