/**
 * Lambda without a URL (ADR-23) that EventBridge Scheduler runs for the day's jobs: the opening at
 * 08:00, the close at 22:00 and the database keep-alive at 04:00 (game time). The opening and the
 * close are stubs (see {@link createHandler}).
 *
 * @packageDocumentation
 */
import { createParameterReader } from '@cronista/parameters';

import { environmentSchema } from './environment.ts';
import { createHandler } from './handler.ts';
import { createDatabasePing } from './keep-alive.ts';

// A missing value fails the cold start instead of a job.
const environment = environmentSchema.parse(process.env);
const parameterExtension = {
  port: environment.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT,
  sessionToken: environment.AWS_SESSION_TOKEN,
};

/** Lambda entry point. */
export const handler = createHandler({
  readProviderKeys: createParameterReader({
    parameterNames: {
      anthropic: environment.ANTHROPIC_API_KEY_PARAMETER,
      voyage: environment.VOYAGE_API_KEY_PARAMETER,
      langfuse: environment.LANGFUSE_SECRET_KEY_PARAMETER,
    },
    ...parameterExtension,
  }),
  pingDatabase: createDatabasePing({
    supabaseUrl: environment.SUPABASE_URL,
    readSecretKey: createParameterReader({
      parameterNames: { supabase: environment.SUPABASE_SECRET_KEY_PARAMETER },
      ...parameterExtension,
    }),
  }),
});
