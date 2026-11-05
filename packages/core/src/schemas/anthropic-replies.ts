import { z } from 'zod';

/** Reply of Anthropic's token counting endpoint. */
export const countTokensReplySchema = z.object({ input_tokens: z.number() });

/** Where a refusal's category sits in the AI SDK's provider metadata for Anthropic. */
export const refusalMetadataSchema = z.object({
  anthropic: z.object({
    stopDetails: z.object({ category: z.string().nullish() }),
  }),
});
