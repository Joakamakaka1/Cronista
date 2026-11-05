import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { LoadBible } from '@cronista/engine';
import { createBibleLoader } from '@cronista/engine/bible';
import { type FlushTraces, startTracing } from '@cronista/narrator';
import { z } from 'zod';

const keysSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  LANGFUSE_PUBLIC_KEY: z.string().min(1),
  LANGFUSE_SECRET_KEY: z.string().min(1),
  VOYAGE_API_KEY: z.string().min(1),
});

/** The keys `pnpm with-secrets` injects, from the `evals` workspace. It never prints them. */
export function localKeys(): z.infer<typeof keysSchema> {
  const keys = keysSchema.safeParse(process.env);
  if (!keys.success) {
    throw new Error('Missing local keys: run this through `pnpm with-secrets` ("Local secrets").');
  }
  return keys.data;
}

/** Traces local runs into the project they share with production, under their own environment. */
export function startLocalTracing(environment: 'local' | 'evals'): FlushTraces {
  const keys = localKeys();
  return startTracing({
    publicKey: keys.LANGFUSE_PUBLIC_KEY,
    secretKey: keys.LANGFUSE_SECRET_KEY,
    baseUrl: 'https://cloud.langfuse.com',
    environment,
  });
}

const inventedBible = fileURLToPath(new URL('../bible/invented.yaml', import.meta.url));

/** Loads the repo's invented bible, whatever the season. */
export const loadInventedBible: LoadBible = createBibleLoader(() =>
  readFile(inventedBible, 'utf8'),
);
