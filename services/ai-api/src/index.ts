/**
 * Lambda behind CloudFront (`/api/ai/*`): the AI hint a player gets when sending the day's action.
 * Verifies the Supabase JWT on every request.
 *
 * @packageDocumentation
 */
import { supabaseSessionVerifier } from '@cronista/http';
import { z } from 'zod';

import { createHandler } from './handler.ts';
import { createProviderKeyReader } from './provider-keys.ts';

// Set by the CDK stack and the Lambda runtime; a missing value fails the cold start, not a request.
const environment = z
  .object({
    SUPABASE_URL: z.url({ protocol: /^https$/ }),
    ANTHROPIC_API_KEY_PARAMETER: z.string().startsWith('/cronista/'),
    VOYAGE_API_KEY_PARAMETER: z.string().startsWith('/cronista/'),
    LANGFUSE_SECRET_KEY_PARAMETER: z.string().startsWith('/cronista/'),
    PARAMETERS_SECRETS_EXTENSION_HTTP_PORT: z.coerce.number().int().positive(),
    AWS_SESSION_TOKEN: z.string().min(1),
  })
  .parse(process.env);

/** Lambda entry point. */
export const handler = createHandler({
  verifySession: supabaseSessionVerifier(environment.SUPABASE_URL),
  readProviderKeys: createProviderKeyReader({
    parameterNames: {
      anthropic: environment.ANTHROPIC_API_KEY_PARAMETER,
      voyage: environment.VOYAGE_API_KEY_PARAMETER,
      langfuse: environment.LANGFUSE_SECRET_KEY_PARAMETER,
    },
    port: environment.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT,
    sessionToken: environment.AWS_SESSION_TOKEN,
  }),
});
