/**
 * Lambda behind CloudFront (`/api/*`): the REST game API. Verifies the Supabase JWT on every request.
 *
 * @packageDocumentation
 */
import { supabaseSessionVerifier } from '@cronista/http';
import { z } from 'zod';

import { createHandler } from './handler.ts';

// Set by the CDK stack; a missing value fails the cold start instead of a request.
const environment = z.object({ SUPABASE_URL: z.url({ protocol: /^https$/ }) }).parse(process.env);

/** Lambda entry point. */
export const handler = createHandler({
  verifySession: supabaseSessionVerifier(environment.SUPABASE_URL),
});
