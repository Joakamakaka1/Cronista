import { extensionEnvironmentSchema } from '@cronista/parameters';
import { z } from 'zod';

/**
 * Environment of the notifier Lambda: what the CDK stack sets (`CronistaWorkers`) plus what the
 * Lambda runtime and the Parameters and Secrets extension add. The handler parses it at cold start.
 */
export const environmentSchema = extensionEnvironmentSchema.extend({
  VAPID_PRIVATE_KEY_PARAMETER: z.string().startsWith('/cronista/'),
  VAPID_PUBLIC_KEY_PARAMETER: z.string().startsWith('/cronista/'),
  ALERTS_TOPIC_ARN: z.string().startsWith('arn:'),
});
