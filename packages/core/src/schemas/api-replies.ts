import { z } from 'zod';

/** What `POST /api/actions` answers when it stores an action: the game day it counts for. */
export const actionReplySchema = z.object({ day: z.iso.date() });

/** What `POST /api/ai/hint` answers: the player's hint, marking whether it is the censor line. */
export const hintReplySchema = z.object({ text: z.string().min(1), censored: z.boolean() });

/** The body of every API error: a snake_case code and never free text. */
export const apiErrorReplySchema = z.object({ error: z.string().regex(/^[a-z_]{1,64}$/) });
