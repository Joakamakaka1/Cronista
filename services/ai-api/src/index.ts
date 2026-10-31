/**
 * Lambda behind CloudFront (`/api/ai/*`): the AI hint a player gets when sending the day's action.
 * Verifies the Supabase JWT on every request.
 *
 * @packageDocumentation
 */
import { supabaseSessionVerifier } from '@cronista/http';
import { createParameterReader } from '@cronista/parameters';

import { environmentSchema } from './environment.ts';
import { createHandler } from './handler.ts';

// A missing value fails the cold start instead of a request.
const environment = environmentSchema.parse(process.env);

/** Lambda entry point. */
export const handler = createHandler({
  verifySession: supabaseSessionVerifier(environment.SUPABASE_URL),
  readProviderKeys: createParameterReader({
    parameterNames: {
      anthropic: environment.ANTHROPIC_API_KEY_PARAMETER,
      voyage: environment.VOYAGE_API_KEY_PARAMETER,
      langfuse: environment.LANGFUSE_SECRET_KEY_PARAMETER,
    },
    port: environment.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT,
    sessionToken: environment.AWS_SESSION_TOKEN,
  }),
});
