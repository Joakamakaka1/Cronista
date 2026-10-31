import { z } from 'zod';

/**
 * What the owner sends `ai-api` with `aws lambda invoke` to check the AI providers from production.
 * A Function URL request never has this shape, so the check has no public surface.
 */
export const providerCheckEventSchema = z.strictObject({ check: z.literal('providers') });

/** The provider check event, validated by {@link providerCheckEventSchema}. */
export type ProviderCheckEvent = z.infer<typeof providerCheckEventSchema>;

/** Reply of the Anthropic Messages API, reduced to its type: the check never keeps the text. */
export const anthropicMessageReplySchema = z.object({ type: z.literal('message') });

/** Reply of the Voyage embeddings API, reduced to proving that a vector came back. */
export const voyageEmbeddingReplySchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()).min(1) })).min(1),
});
