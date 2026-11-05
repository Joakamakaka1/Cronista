/**
 * Embeds the golden set with Voyage, as production does: moments with `voyage-4`, queries with
 * `voyage-4-lite`. It spends a fraction of a cent, and only when the golden set changes.
 *
 * Usage: `pnpm golden:embed`.
 *
 * @packageDocumentation
 */
import { writeFileSync } from 'node:fs';

import { z } from 'zod';

import { createVoyage } from '../src/voyage.ts';
import { encodeVector, GOLDEN_EMBEDDINGS_FILE, GOLDEN_MOMENTS, GOLDEN_QUERIES } from './index.ts';

const { VOYAGE_API_KEY } = z
  .object({ VOYAGE_API_KEY: z.string().min(1) })
  .parse(process.env, { error: () => 'Run this through `pnpm with-secrets` ("Local secrets").' });

const voyage = createVoyage({ apiKey: VOYAGE_API_KEY, workspace: 'evals' });
const [documents, queries] = await Promise.all([
  voyage.embedDocuments(GOLDEN_MOMENTS.map(({ text }) => text)),
  voyage.embedQueries(GOLDEN_QUERIES.map(({ text }) => text)),
]);
if (!documents.ok || !queries.ok) throw new Error('Voyage did not embed the golden set.');

const byKey = (keys: readonly string[], vectors: readonly number[][]) =>
  Object.fromEntries(keys.map((key, index) => [key, encodeVector(vectors[index] ?? [])]));

writeFileSync(
  GOLDEN_EMBEDDINGS_FILE,
  `${JSON.stringify(
    {
      documentModel: 'voyage-4',
      queryModel: 'voyage-4-lite',
      documents: byKey(
        GOLDEN_MOMENTS.map(({ key }) => key),
        documents.value,
      ),
      queries: byKey(
        GOLDEN_QUERIES.map(({ key }) => key),
        queries.value,
      ),
    },
    null,
    2,
  )}\n`,
);
const tokens = [...documents.usage, ...queries.usage].reduce(
  (total, row) => total + row.inputTokens,
  0,
);
console.log(
  `Embedded ${String(GOLDEN_MOMENTS.length + GOLDEN_QUERIES.length)} texts, ${String(tokens)} tokens.`,
);
