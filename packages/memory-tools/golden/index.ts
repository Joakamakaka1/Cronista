/**
 * The N1 golden set and its cached embeddings, so that retrieval is measured with no Voyage call.
 * Node only: tests and scripts read it, and no Lambda bundles it.
 *
 * @packageDocumentation
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

export * from './dataset.ts';

/** Where `pnpm golden:embed` writes the vectors. */
export const GOLDEN_EMBEDDINGS_FILE = fileURLToPath(new URL('./embeddings.json', import.meta.url));

const embeddingsSchema = z.object({
  documentModel: z.string(),
  queryModel: z.string(),
  documents: z.record(z.string(), z.string()),
  queries: z.record(z.string(), z.string()),
});

/** A vector as the cache keeps it: float32, little endian, in base64. */
export function encodeVector(vector: readonly number[]): string {
  return Buffer.from(new Float32Array(vector).buffer).toString('base64');
}

const decodeVector = (encoded: string): number[] => {
  const bytes = Buffer.from(encoded, 'base64');
  return [...new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)];
};

/** The cached vectors of every golden moment and query, by key. */
export function goldenEmbeddings(): {
  readonly documents: ReadonlyMap<string, number[]>;
  readonly queries: ReadonlyMap<string, number[]>;
} {
  const cached = embeddingsSchema.parse(JSON.parse(readFileSync(GOLDEN_EMBEDDINGS_FILE, 'utf8')));
  const decoded = (entries: Record<string, string>) =>
    new Map(Object.entries(entries).map(([key, value]) => [key, decodeVector(value)]));
  return { documents: decoded(cached.documents), queries: decoded(cached.queries) };
}
