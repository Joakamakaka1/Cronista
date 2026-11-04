import { extensionEnvironmentSchema } from '@cronista/parameters';
import { z } from 'zod';

/**
 * Environment of the core-api Lambda: what the CDK stack sets (`CronistaEdge`) plus what the Lambda
 * runtime and the Parameters and Secrets extension add. The handler parses it at cold start.
 */
export const environmentSchema = extensionEnvironmentSchema.extend({
  SUPABASE_URL: z.url({ protocol: /^https$/ }),
  SUPABASE_SECRET_KEY_PARAMETER: z.string().startsWith('/cronista/'),
  SITE_URL: z.url({ protocol: /^https$/ }),
});
