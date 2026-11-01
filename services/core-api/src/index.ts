/**
 * Lambda behind CloudFront (`/api/*`): the REST game API. Verifies the Supabase JWT on every request.
 * The deploy workflows also invoke it directly to check the public site from inside AWS (see
 * {@link createEntryPoint}).
 *
 * @packageDocumentation
 */
import { supabaseSessionVerifier } from '@cronista/http';

import { createEntryPoint } from './entry-point.ts';
import { environmentSchema } from './environment.ts';
import { createHandler } from './handler.ts';
import { createSiteCheck } from './site-check.ts';

// A missing value fails the cold start instead of a request.
const environment = environmentSchema.parse(process.env);

/** Lambda entry point. */
export const handler = createEntryPoint({
  http: createHandler({
    verifySession: supabaseSessionVerifier(environment.SUPABASE_URL),
  }),
  checkSite: createSiteCheck({ siteUrl: environment.SITE_URL }),
});
