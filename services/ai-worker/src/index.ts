/**
 * Lambda without a URL (ADR-23) that EventBridge Scheduler runs for the day's jobs: the opening at
 * 08:00 and the close at 22:00 (game time). The jobs are stubs (see {@link createHandler}).
 *
 * @packageDocumentation
 */
import { createParameterReader } from '@cronista/parameters';

import { environmentSchema } from './environment.ts';
import { createHandler } from './handler.ts';

// A missing value fails the cold start instead of a job.
const environment = environmentSchema.parse(process.env);

/** Lambda entry point. */
export const handler = createHandler({
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
