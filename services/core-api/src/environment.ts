import { z } from 'zod';

/** Environment of the core-api Lambda, set by the CDK stack (`CronistaEdge`) and parsed at cold start. */
export const environmentSchema = z.object({ SUPABASE_URL: z.url({ protocol: /^https$/ }) });
