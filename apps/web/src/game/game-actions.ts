import { actionReplySchema, hintReplySchema } from '@cronista/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { postToApi } from '../api/post-to-api.ts';
import { GAME_QUERY_KEY } from './game-queries.ts';

/** How a write to the API ended: done, or the error code to explain to the player. */
export type WriteResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/** Sends today's action and stake. The text and stake never change after this succeeds. */
export function useSendAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: {
      readonly text: string;
      readonly stake: number;
    }): Promise<WriteResult<{ readonly day: string }>> => {
      const reply = await postToApi('/api/actions', action);
      if (!reply.ok) return reply;
      const parsed = actionReplySchema.safeParse(reply.body);
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: 'internal' };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [GAME_QUERY_KEY] }),
  });
}

/**
 * Asks for the hint on today's action. A second request returns the stored hint, and a technical
 * failure spends nothing, so asking again is always safe.
 */
export function useRequestHint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<
      WriteResult<{ readonly text: string; readonly censored: boolean }>
    > => {
      const reply = await postToApi('/api/ai/hint', {});
      if (!reply.ok) return reply;
      const parsed = hintReplySchema.safeParse(reply.body);
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: 'internal' };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [GAME_QUERY_KEY] }),
  });
}
