/**
 * Lambda behind CloudFront (`/api/*`): the REST game API. Verifies the Supabase JWT on every request.
 *
 * @packageDocumentation
 */
import { supabaseSessionVerifier } from '@cronista/http';

import { environmentSchema } from './environment.ts';
import { createHandler } from './handler.ts';

// A missing value fails the cold start instead of a request.
const environment = environmentSchema.parse(process.env);

/** Lambda entry point. */
export const handler = createHandler({
  verifySession: supabaseSessionVerifier(environment.SUPABASE_URL),
});
