import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, use, useEffect, useState } from 'react';

import { supabase } from '../supabase.ts';
import { isPlayerChange } from './player-change.ts';

/** Where the player's session stands. `expired` marks a session that ended without signing out. */
export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed_out'; readonly expired: boolean }
  | { readonly status: 'signed_in'; readonly session: Session };

const SessionContext = createContext<SessionState>({ status: 'loading' });

/**
 * Keeps the Supabase session in React state, following sign-in, refresh and sign-out. The cached
 * game data goes whenever the player changes or signs out, since it holds what only they may read.
 */
export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let userId: string | null = null;
    let signedIn = false;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      // Another tab can sign in someone else: never show them the previous player's reads.
      const nextUserId = session?.user.id ?? null;
      if (isPlayerChange(userId, nextUserId)) queryClient.clear();
      userId = nextUserId;
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
  }, [queryClient]);

  return <SessionContext value={state}>{children}</SessionContext>;
}

/** The player's session, as {@link SessionProvider} keeps it. */
export function useSession(): SessionState {
  return use(SessionContext);
}
