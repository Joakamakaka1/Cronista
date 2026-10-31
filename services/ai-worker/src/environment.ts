import { extensionEnvironmentSchema } from '@cronista/parameters';
import { z } from 'zod';

/**
 * Environment of the ai-worker Lambda: what the CDK stack sets (`CronistaWorkers`) plus what the
 * Lambda runtime and the Parameters and Secrets extension add. The handler parses it at cold start.
 */
export const environmentSchema = extensionEnvironmentSchema.extend({
  ANTHROPIC_API_KEY_PARAMETER: z.string().startsWith('/cronista/'),
  VOYAGE_API_KEY_PARAMETER: z.string().startsWith('/cronista/'),
  LANGFUSE_SECRET_KEY_PARAMETER: z.string().startsWith('/cronista/'),
  SUPABASE_URL: z.url({ protocol: /^https$/ }),
  SUPABASE_SECRET_KEY_PARAMETER: z.string().startsWith('/cronista/'),
});
