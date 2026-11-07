import { actionReplySchema, type Hint, hintReplySchema, type Result } from '@cronista/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { postToApi } from '../api/post-to-api.ts';
import { GAME_QUERY_KEY } from './game-queries.ts';

/** Sends today's action and stake. The text and stake never change after this succeeds. */
export function useSendAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: {
      readonly text: string;
      readonly stake: number;
    }): Promise<Result<{ readonly day: string }, string>> => {
      const reply = await postToApi('/api/actions', action);
      if (!reply.ok) return reply;
      const parsed = actionReplySchema.safeParse(reply.value);
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
    mutationFn: async (): Promise<Result<Hint, string>> => {
      const reply = await postToApi('/api/ai/hint', {});
      if (!reply.ok) return reply;
      const parsed = hintReplySchema.safeParse(reply.value);
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: 'internal' };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [GAME_QUERY_KEY] }),
  });
}
