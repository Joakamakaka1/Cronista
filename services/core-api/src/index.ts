/**
 * Lambda behind CloudFront (`/api/*`): the REST game API. Verifies the Supabase JWT on every request.
 * The deploy workflows also invoke it directly to check the public site from inside AWS (see
 * {@link createEntryPoint}).
 *
 * @packageDocumentation
 */
import { CLIENT_ERROR_METRIC, embeddedMetricLine, SITE_METRIC_NAMESPACE } from '@cronista/core';
import { lazyGameStore, submitAction } from '@cronista/engine';
import { supabaseSessionVerifier } from '@cronista/http';
import { createSiteCheck } from '@cronista/http/site-check';
import { createParameterReader } from '@cronista/parameters';

import { createEntryPoint } from './entry-point.ts';
import { environmentSchema } from './environment.ts';
import { createHandler } from './handler.ts';

// A missing value fails the cold start instead of a request.
const environment = environmentSchema.parse(process.env);

const gameStore = lazyGameStore(
  environment.SUPABASE_URL,
  createParameterReader({
    parameterNames: { supabase: environment.SUPABASE_SECRET_KEY_PARAMETER },
    port: environment.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT,
    sessionToken: environment.AWS_SESSION_TOKEN,
  }),
);

/** Lambda entry point. */
export const handler = createEntryPoint({
  http: createHandler({
    verifySession: supabaseSessionVerifier(environment.SUPABASE_URL),
    reportClientError: () => {
      process.stdout.write(
        embeddedMetricLine(SITE_METRIC_NAMESPACE, CLIENT_ERROR_METRIC, new Date()),
      );
    },
    submitAction: async (input) => {
      const store = await gameStore();
      if (!store.ok) return store;
      return submitAction({ store: store.value, clock: () => new Date() }, input);
    },
  }),
  checkSite: createSiteCheck({ siteUrl: environment.SITE_URL }),
});
