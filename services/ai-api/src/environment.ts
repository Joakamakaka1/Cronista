import { extensionEnvironmentSchema } from '@cronista/parameters';
import { z } from 'zod';

/**
 * Environment of the ai-api Lambda: what the CDK stack sets (`CronistaEdge`) plus what the Lambda
 * runtime and the Parameters and Secrets extension add. The handler parses it at cold start.
 */
export const environmentSchema = extensionEnvironmentSchema.extend({
  SUPABASE_URL: z.url({ protocol: /^https$/ }),
  ANTHROPIC_API_KEY_PARAMETER: z.string().startsWith('/cronista/'),
  VOYAGE_API_KEY_PARAMETER: z.string().startsWith('/cronista/'),
  LANGFUSE_SECRET_KEY_PARAMETER: z.string().startsWith('/cronista/'),
});
