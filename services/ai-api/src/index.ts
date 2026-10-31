/**
 * Lambda behind CloudFront (`/api/ai/*`): the AI hint a player gets when sending the day's action.
 * Verifies the Supabase JWT on every request. The owner can also invoke it directly to check the
 * AI providers from production (see {@link createEntryPoint}).
 *
 * @packageDocumentation
 */
import { supabaseSessionVerifier } from '@cronista/http';
import { createParameterReader } from '@cronista/parameters';

import { createEntryPoint } from './entry-point.ts';
import { environmentSchema } from './environment.ts';
import { createHandler } from './handler.ts';
import { createProviderCheck } from './provider-check.ts';

// A missing value fails the cold start instead of a request.
const environment = environmentSchema.parse(process.env);
const parameterExtension = {
  port: environment.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT,
  sessionToken: environment.AWS_SESSION_TOKEN,
};
const providerKeyNames = {
  anthropic: environment.ANTHROPIC_API_KEY_PARAMETER,
  voyage: environment.VOYAGE_API_KEY_PARAMETER,
  langfuse: environment.LANGFUSE_SECRET_KEY_PARAMETER,
};

/** Lambda entry point. */
export const handler = createEntryPoint({
  http: createHandler({
    verifySession: supabaseSessionVerifier(environment.SUPABASE_URL),
    readProviderKeys: createParameterReader({
      parameterNames: providerKeyNames,
      ...parameterExtension,
    }),
  }),
  checkProviders: createProviderCheck({
    readProviderKeys: createParameterReader({
      parameterNames: {
        ...providerKeyNames,
        langfusePublic: environment.LANGFUSE_PUBLIC_KEY_PARAMETER,
      },
      ...parameterExtension,
    }),
    langfuseUrl: environment.LANGFUSE_URL,
  }),
});
