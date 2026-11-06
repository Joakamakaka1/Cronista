import { useQueryClient } from '@tanstack/react-query';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { useEffect } from 'react';

import { supabase } from '../supabase.ts';
import { GAME_QUERY_KEY } from './game-queries.ts';

/**
 * Refetches the game whenever a day opens or changes state, someone plays or a chapter is
 * published, so the screen updates without a reload. Realtime checks each event against the
 * player's RLS, and these rows hold no action text or stake.
 */
export function useLiveGameUpdates(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const refetch = () => {
      void queryClient.invalidateQueries({ queryKey: [GAME_QUERY_KEY] });
    };
    // A topic of its own: supabase-js would hand back a channel of the same name still leaving.
    const channel = supabase.channel(`game:${crypto.randomUUID()}`);
    for (const table of ['game_days', 'actions', 'chapters'] as const) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, refetch);
    }
    // After a dropped connection, catch up on whatever happened meanwhile.
    channel.subscribe((status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) refetch();
    });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);
}
