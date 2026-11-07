import { useState } from 'react';
import { Navigate, useLocation } from 'react-router';

import { Logo } from '../brand/logo.tsx';
import { Mascot } from '../brand/mascot.tsx';
import type { Seat } from '../brand/seat.ts';
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
  const from = typeof location.state === 'string' ? location.state : '/';

  if (session.status === 'signed_in') return <Navigate to={from} replace />;

  const message = signInFailed
    ? 'No te dejan pasar. ¿Seguro que es la cuenta de Google con la que juegas?'
    : session.status === 'signed_out' && session.expired
      ? 'Tu sesión ha palmado. Vuelve a entrar.'
      : null;

  return (
    <div className="relative mx-auto min-h-dvh w-full max-w-[440px] overflow-hidden bg-bg">
      <div
        aria-hidden
        className="repeat-word absolute -top-8 -left-16 w-[640px] -rotate-9 text-[104px] leading-[0.9] tracking-[-4px] text-[var(--repeat-word)]"
      >
        {Array.from({ length: 10 }, () => 'CRONISTA').join('\n')}
      </div>

      <main className="relative flex min-h-dvh flex-col px-6 pt-[max(58px,env(safe-area-inset-top))] pb-[max(40px,env(safe-area-inset-bottom))]">
        <span className="sticker -rotate-6 self-start rounded-[15px] px-[13px] py-[7px] text-base">
          Temporada 0: nadie sale vivo
        </span>

        <div className="mt-16 flex flex-col items-center gap-[22px]">
          <h1 className="sr-only">Cronista</h1>
          <Logo width={330} />
          <div className="flex justify-center">
            {lineUp.map(({ seat, tilt }) => (
              <span key={seat} className="-mr-2.5 block last:mr-0" style={{ transform: tilt }}>
                <Mascot who={seat} size={64} />
              </span>
            ))}
          </div>
        </div>

        <div
          aria-hidden
          className="hazard-tape relative -mx-14 mt-10 flex h-[34px] -rotate-5 items-center justify-center"
        >
          <span className="rounded-md bg-sticker-ink px-3 py-[3px] font-display text-[13px] tracking-[0.04em] text-white">
            PELIGRO: NARRADOR SUELTO
          </span>
        </div>

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
          <button
            type="button"
            disabled={starting}
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
          </button>
          <p className="text-center text-[13px] text-muted">
            Solo entran los cinco pringados que juegan. Los demás, a llorar a otra parte.
          </p>
        </div>
      </main>
    </div>
  );
}
