import { z } from 'zod';

/** The dimensions of every embedding in memory, documents and queries alike. */
export const EMBEDDING_DIMENSIONS = 1024;

const usage = z.object({ total_tokens: z.int().min(0) });

/** Reply of the Voyage embeddings API: one vector of the expected size per input, by index. */
export const voyageEmbeddingsReplySchema = z.object({
  data: z.array(
    z.object({
      index: z.int().min(0),
      embedding: z.array(z.number()).length(EMBEDDING_DIMENSIONS),
    }),
  ),
  usage,
});

/** Reply of the Voyage rerank API: documents by index, most relevant first. */
export const voyageRerankReplySchema = z.object({
  data: z.array(z.object({ index: z.int().min(0), relevance_score: z.number() })),
  usage,
});

/** One row of `hybrid_search`, with each list's rank so that a ranking can be explained. */
export const hybridSearchRowSchema = z.object({
  id: z.number(),
  day: z.iso.date(),
  content: z.string(),
  characters: z.array(z.string()),
  joke: z.string().nullable(),
  importance: z.number().nullable(),
  joke_last_day: z.iso.date().nullable(),
  vector_rank: z.number().nullable(),
  text_rank: z.number().nullable(),
  name_rank: z.number().nullable(),
  rrf_score: z.number(),
});

/** What `hybrid_search` answers. */
export const hybridSearchReplySchema = z.array(hybridSearchRowSchema);

/** One row of `hybrid_search`, validated by {@link hybridSearchRowSchema}. */
export type HybridSearchRow = z.infer<typeof hybridSearchRowSchema>;

/** What `nearest_moments` answers. */
export const nearestMomentsReplySchema = z.array(
  z.object({ id: z.number(), day: z.iso.date(), content: z.string(), distance: z.number() }),
);

const rejected = <Code extends string>(codes: readonly [Code, ...Code[]]) =>
  z.object({ ok: z.literal(false), error: z.enum(codes) });

/** What `store_moments` answers. */
export const storeMomentsReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), status: z.enum(['written', 'already_written']) }),
  rejected(['not_published', 'invalid_supersedes', 'invalid_moment']),
]);

/** What `store_chapter_chunks` answers. */
export const storeChapterChunksReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), status: z.enum(['stored', 'already_stored']) }),
  rejected(['not_published', 'invalid_chunks']),
]);
