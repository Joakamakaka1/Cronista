import { z } from 'zod';

/**
 * The part of an SQS event, as the Lambda event source mapping delivers it, that a consumer reads:
 * each record's ID (to report it as failed) and its body, still unparsed.
 */
export const sqsEventSchema = z.object({
  Records: z.array(z.object({ messageId: z.string().min(1), body: z.string() })),
});
