import { z } from 'zod';

/**
 * Claims of a Supabase session JWT that the API relies on, once its signature, issuer, audience and
 * expiry are verified. Anonymous sessions and any role other than `authenticated` are rejected.
 */
export const sessionClaimsSchema = z.object({
  sub: z.uuid(),
  role: z.literal('authenticated'),
  is_anonymous: z.literal(false).optional(),
});

/** Session claims after {@link sessionClaimsSchema} has validated them. */
export type SessionClaims = z.infer<typeof sessionClaimsSchema>;
