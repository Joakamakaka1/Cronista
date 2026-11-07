import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { Navigate, useLocation } from 'react-router';

import { Logo } from '../brand/logo.tsx';
import { Mascot } from '../brand/mascot.tsx';
import { RepeatWords } from '../brand/repeat-words.tsx';
import type { Seat } from '../brand/seat.ts';
import { Slap } from '../brand/slap.tsx';
import { useSession } from '../session/session.tsx';
import { signInFailed } from '../session/sign-in-error.ts';
import { supabase } from '../supabase.ts';

// The five hoods huddled under the logo, each at its own tilt.
const lineUp: readonly { readonly seat: Seat; readonly tilt: string }[] = [
  { seat: 0, tilt: 'rotate(-8deg) translateY(6px)' },
  { seat: 1, tilt: 'rotate(-3deg)' },
  { seat: 2, tilt: 'translateY(-6px)' },
  { seat: 3, tilt: 'rotate(4deg)' },
  { seat: 4, tilt: 'rotate(9deg) translateY(6px)' },
];

/** Where a signed-out player lands: one way in, with Google. No painterly blend here. */
export function SignInPage() {
  const session = useSession();
  const location = useLocation();
  const [starting, setStarting] = useState(false);
  const still = useReducedMotion() === true;
  const from = typeof location.state === 'string' ? location.state : '/';

  if (session.status === 'signed_in') return <Navigate to={from} replace />;

  const message = signInFailed
    ? 'No te dejan pasar. ¿Seguro que es la cuenta de Google con la que juegas?'
    : session.status === 'signed_out' && session.expired
      ? 'Tu sesión ha palmado. Vuelve a entrar.'
      : null;

  return (
    <div className="relative mx-auto min-h-dvh w-full max-w-[440px] overflow-hidden bg-bg">
      <RepeatWords
        word="CRONISTA"
        count={10}
        className="absolute -top-8 -left-16 w-[640px] -rotate-9 text-[104px] leading-[0.9] tracking-[-4px] text-[var(--repeat-word)]"
      />

      <main className="relative flex min-h-dvh flex-col px-6 pt-[max(58px,env(safe-area-inset-top))] pb-[max(40px,env(safe-area-inset-bottom))]">
        <Slap
          rotate={-6}
          delay={0.15}
          className="sticker self-start rounded-[15px] px-[13px] py-[7px] text-base"
        >
          Temporada 0: nadie sale vivo
        </Slap>

        <div className="mt-16 flex flex-col items-center gap-[22px]">
          <h1 className="sr-only">Cronista</h1>
          <Logo width={330} />
          <div className="flex justify-center">
            {lineUp.map(({ seat, tilt }) => (
              <motion.span
                key={seat}
                className="-mr-2.5 block last:mr-0"
                initial={still ? false : { y: 40, opacity: 0, scale: 0.6 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                whileTap={still ? {} : { scale: 1.15, rotate: -6 }}
                transition={
                  still
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 360, damping: 14, delay: 0.35 + seat * 0.08 }
                }
              >
                <span className="block" style={{ transform: tilt }}>
                  <Mascot who={seat} size={64} alive />
                </span>
              </motion.span>
            ))}
          </div>
        </div>

        <motion.div
          aria-hidden
          className="hazard-tape relative -mx-14 mt-10 flex h-[34px] -rotate-5 items-center justify-center"
          initial={still ? false : { x: '-110%' }}
          animate={{ x: 0 }}
          transition={
            still ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 18, delay: 0.7 }
          }
        >
          <span className="rounded-md bg-sticker-ink px-3 py-[3px] font-display text-[13px] tracking-[0.04em] text-white">
            PELIGRO: NARRADOR SUELTO
          </span>
        </motion.div>
        <motion.svg
          aria-hidden
          width="60"
          height="60"
          viewBox="0 0 100 100"
          className="mt-3 mr-1 rotate-10 self-end"
          style={{ fill: 'var(--ink)', stroke: 'var(--ink)' }}
          animate={still ? { rotate: 0 } : { rotate: 360 }}
          transition={still ? { duration: 0 } : { duration: 40, repeat: Infinity, ease: 'linear' }}
        >
          <path d="M50 4 Q 54 44 96 50 Q 54 56 50 96 Q 46 56 4 50 Q 46 44 50 4 Z" stroke="none" />
          <ellipse
            cx="50"
            cy="50"
            rx="46"
            ry="14"
            fill="none"
            strokeWidth="3.5"
            transform="rotate(-30 50 50)"
            strokeDasharray="120 30"
          />
        </motion.svg>

        <div className="mt-auto flex flex-col gap-3.5 pt-10">
          <p className="mb-1.5 text-center text-[17px] leading-[1.45] font-medium text-reading">
            Cinco desgraciados, una jugada al día y un narrador sin escrúpulos que a las diez os
            pone a parir.
          </p>
          {message !== null && (
            <p role="alert" className="text-center font-semibold text-danger">
              {message}
            </p>
          )}
          <motion.button
            type="button"
            disabled={starting}
            whileTap={still ? {} : { scale: 0.97 }}
            className="flex min-h-[58px] items-center justify-center gap-3 rounded-full bg-primary text-[17px] font-bold text-on-primary disabled:opacity-60"
            onClick={() => {
              setStarting(true);
              void supabase.auth
                .signInWithOAuth({
                  provider: 'google',
                  options: { redirectTo: `${window.location.origin}${from}` },
                })
                .then(({ error }) => {
                  if (error !== null) setStarting(false);
                });
            }}
          >
            <span className="grid size-[30px] place-items-center rounded-full bg-white">
              <svg aria-hidden width="18" height="18" viewBox="0 0 24 24">
                <path
                  d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"
                  fill="#4285f4"
                />
                <path
                  d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"
                  fill="#34a853"
                />
                <path
                  d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z"
                  fill="#fbbc05"
                />
                <path
                  d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.4 3-4.1 5.6-4.1z"
                  fill="#ea4335"
                />
              </svg>
            </span>
            {starting ? 'Abriendo Google…' : 'Entrar con Google'}
          </motion.button>
          <p className="text-center text-[13px] text-muted">
            Solo entran los cinco pringados que juegan. Los demás, a llorar a otra parte.
          </p>
        </div>
      </main>
    </div>
  );
}
