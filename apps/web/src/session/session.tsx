import type { Session } from '@supabase/supabase-js';
import { createContext, type ReactNode, use, useEffect, useState } from 'react';

import { supabase } from '../supabase.ts';

/** Where the player's session stands. `expired` marks a session that ended without signing out. */
export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed_out'; readonly expired: boolean }
  | { readonly status: 'signed_in'; readonly session: Session };

const SessionContext = createContext<SessionState>({ status: 'loading' });

/** Keeps the Supabase session in React state, following sign-in, refresh and sign-out. */
export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let signedIn = false;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session === null) {
        setState({ status: 'signed_out', expired: signedIn });
      } else {
        signedIn = true;
        setState({ status: 'signed_in', session });
      }
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  return <SessionContext value={state}>{children}</SessionContext>;
}

/** The player's session, as {@link SessionProvider} keeps it. */
export function useSession(): SessionState {
  return use(SessionContext);
}
