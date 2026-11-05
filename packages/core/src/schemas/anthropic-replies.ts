import { z } from 'zod';

/** Reply of Anthropic's token counting endpoint. */
export const countTokensReplySchema = z.object({ input_tokens: z.number() });

/** The error Anthropic answers with. Its message can quote the request, so it is never logged. */
export const anthropicErrorReplySchema = z.object({ error: z.object({ message: z.string() }) });

/** Where a refusal's category sits in the AI SDK's provider metadata for Anthropic. */
export const refusalMetadataSchema = z.object({
  anthropic: z.object({
    stopDetails: z.object({ category: z.string().nullish() }),
  }),
});
