import { z } from 'zod';

/**
 * Longest action a player can send, in UTF-16 code units (what `String.length` counts), after
 * trimming. Even when every unit is escaped in JSON, the request body stays under the WAF's 8 KB.
 */
export const MAX_ACTION_CHARACTERS = 1000;

/**
 * The day's action as the player sends it: plain text, not editable once sent, and the most the
 * narrator may charge for it. Whether the stake is in range depends on the balance, so it is checked
 * when the action is stored, and answers with its own error code.
 */
export const actionSchema = z.strictObject({
  text: z
    .string()
    .trim()
    .min(1)
    .max(MAX_ACTION_CHARACTERS)
    // Postgres text cannot hold it, so it would fail as an outage instead of a bad request.
    .refine((text) => !text.includes('\u0000')),
  stake: z.int(),
});

/** A player's action after {@link actionSchema} has validated and trimmed it. */
export type Action = z.infer<typeof actionSchema>;
