import { z } from 'zod';

/**
 * Reply of the AWS Parameters and Secrets Lambda Extension to a parameter read
 * (`/systemsmanager/parameters/get`), reduced to the decrypted value.
 */
export const parameterStoreReplySchema = z.object({
  Parameter: z.object({ Value: z.string().min(1) }),
});
