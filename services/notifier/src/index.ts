/**
 * Lambda without a URL (ADR-23) fed by the notifications queue, where Scheduler leaves the
 * reminders. Sending with Web Push (VAPID) is a stub (see {@link createHandler}).
 *
 * @packageDocumentation
 */
import { createParameterReader } from '@cronista/parameters';

import { environmentSchema } from './environment.ts';
import { createHandler } from './handler.ts';

// A missing value fails the cold start instead of a batch.
const environment = environmentSchema.parse(process.env);

/** Lambda entry point. */
export const handler = createHandler({
  readVapidKeys: createParameterReader({
    parameterNames: {
      privateKey: environment.VAPID_PRIVATE_KEY_PARAMETER,
      publicKey: environment.VAPID_PUBLIC_KEY_PARAMETER,
    },
    port: environment.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT,
    sessionToken: environment.AWS_SESSION_TOKEN,
  }),
});
