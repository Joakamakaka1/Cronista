import { z } from 'zod';

/**
 * Variables that the Lambda runtime and the Parameters and Secrets extension set, which
 * {@link createParameterReader} needs. Each Lambda's environment schema extends it.
 */
export const extensionEnvironmentSchema = z.object({
  PARAMETERS_SECRETS_EXTENSION_HTTP_PORT: z.coerce.number().int().positive(),
  AWS_SESSION_TOKEN: z.string().min(1),
});
