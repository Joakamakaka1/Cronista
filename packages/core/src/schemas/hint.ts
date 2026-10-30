import { z } from 'zod';

/**
 * Body of a hint request: an empty JSON object. The hint is about the player's own action of the
 * day, so the client sends nothing that could steer it.
 */
export const hintRequestSchema = z.strictObject({});
