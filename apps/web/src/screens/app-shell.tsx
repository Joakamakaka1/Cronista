import { BookOpen, Clock } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import {
  Navigate,
  NavLink,
  ScrollRestoration,
  useLocation,
  useMatch,
  useOutlet,
} from 'react-router';

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
  { to: '/', label: 'Hoy', Icon: Clock },
  { to: '/capitulos', label: 'Capítulos', Icon: BookOpen },
  { to: '/personajes', label: 'Personajes', Icon: FacesIcon },
] as const;

const tabSpring = { type: 'spring', stiffness: 520, damping: 38 } as const;

// The screen that is leaving keeps what it showed while it fades out.
function FrozenOutlet() {
  const outlet = useOutlet();
  const [frozen] = useState(outlet);
  return frozen;
}

/**
 * The signed-in frame: one phone-width column, centred on a desktop, screens that hand over to each
 * other, and the floating tabs within thumb's reach, whose pill slides to the tab you pick. A
 * chapter is read without them.
 */
export function AppShell() {
  const session = useSession();
  const location = useLocation();
  const reading = useMatch('/capitulos/:day') !== null;
  const still = useReducedMotion() === true;
  useLiveGameUpdates(session.status === 'signed_in');

  if (session.status === 'loading') return <Loading />;
  if (session.status === 'signed_out') {
    // Back here after signing in, so a shared link to a chapter still opens it.
    return <Navigate to="/entrar" state={location.pathname} replace />;
  }

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col overflow-x-clip">
      <ScrollRestoration />
      <main className={cn('flex-1', !reading && 'pb-[calc(120px+env(safe-area-inset-bottom))]')}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            // A new player gets fresh screens: no form text or state from whoever was here before.
            key={`${session.session.user.id}:${location.pathname}`}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={still ? { duration: 0 } : { duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
          >
            <FrozenOutlet />
          </motion.div>
        </AnimatePresence>
      </main>
      {!reading && (
        <motion.nav
          aria-label="Secciones"
          className="nav-pill fixed bottom-[calc(22px+env(safe-area-inset-bottom))] left-1/2 z-20 flex w-[300px] -translate-x-1/2 gap-1 rounded-full p-1.5"
          initial={still ? false : { y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={still ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 30 }}
        >
          {tabs.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  'relative flex h-12 items-center justify-center rounded-full text-sm font-bold transition-[flex-grow,width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]',
                  isActive ? 'flex-1 text-sticker-ink' : 'w-16 text-nav-idle active:scale-90',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-full bg-paper"
                      transition={still ? { duration: 0 } : tabSpring}
                    />
                  )}
                  <span className="relative flex items-center gap-1.5">
                    <Icon size={isActive ? 18 : 20} />
                    {isActive && (
                      <motion.span
                        aria-hidden
                        initial={still ? false : { opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={still ? { duration: 0 } : { delay: 0.08, duration: 0.2 }}
                      >
                        {label}
                      </motion.span>
                    )}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </motion.nav>
      )}
    </div>
  );
}
