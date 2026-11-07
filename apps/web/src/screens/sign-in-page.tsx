import { useState } from 'react';
import { Navigate, useLocation } from 'react-router';

import { useSession } from '../session/session.tsx';
import { signInFailed } from '../session/sign-in-error.ts';
import { supabase } from '../supabase.ts';
import { Button } from '../ui/button.tsx';

/** Where a signed-out player lands: one way in, with Google. */
export function SignInPage() {
  const session = useSession();
  const location = useLocation();
  const [starting, setStarting] = useState(false);
  const from = typeof location.state === 'string' ? location.state : '/';

  if (session.status === 'signed_in') return <Navigate to={from} replace />;

  const message = signInFailed
    ? 'No se pudo entrar. ¿Es la cuenta de Google con la que juegas?'
    : session.status === 'signed_out' && session.expired
      ? 'Tu sesión ha caducado. Vuelve a entrar.'
      : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-end gap-10 px-6 pt-16 pb-[max(3rem,env(safe-area-inset-bottom))]">
      <div className="flex flex-col gap-4">
        <h1 className="font-serif text-6xl font-semibold tracking-tight text-ink">Cronista</h1>
        <p className="prose-reading text-muted">
          Cada día, una acción. Cada noche a las 22:00, un capítulo.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {message !== null && (
          <p role="alert" className="text-censor">
            {message}
          </p>
        )}
        <Button
          disabled={starting}
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
          {starting ? 'Abriendo Google…' : 'Entrar con Google'}
        </Button>
        <p className="text-sm text-muted">Solo pueden entrar las cinco personas que juegan.</p>
      </div>
    </main>
  );
}
