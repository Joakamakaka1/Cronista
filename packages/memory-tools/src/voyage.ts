import {
  type AiFunction,
  type AiUsage,
  EMBEDDING_DIMENSIONS,
  voyageEmbeddingsReplySchema,
  voyageRerankReplySchema,
  type Workspace,
} from '@cronista/core';
import type { z } from 'zod';

/** A Voyage call's answer or failure, with the ledger rows of every request it took. */
export type VoyageResult<Value> = (
  { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: 'technical' }
) & { readonly usage: readonly AiUsage[] };

/** Embeddings and reranking for memory, through Voyage AI. */
export interface Voyage {
  /** Documents (moments and chunks) with `voyage-4`. */
  readonly embedDocuments: (texts: readonly string[]) => Promise<VoyageResult<number[][]>>;
  /** Queries with `voyage-4-lite`, whose vectors share the space of `voyage-4`'s. */
  readonly embedQueries: (texts: readonly string[]) => Promise<VoyageResult<number[][]>>;
  /** The indexes of the `topK` documents most relevant to the query, most relevant first. */
  readonly rerank: (
    query: string,
    documents: readonly string[],
    topK: number,
  ) => Promise<VoyageResult<number[]>>;
}

/** What {@link createVoyage} needs. */
export interface VoyageOptions {
  readonly apiKey: string;
  /** The game's workspace for the ledger, so that memory's spend counts with the narrator's. */
  readonly workspace: Workspace;
  /** Replaces the global `fetch` in tests. */
  readonly fetch?: typeof fetch;
  /** Replaces waiting out a rate limit in tests. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const apiUrl = 'https://api.voyageai.com/v1';

/** Dollars per million tokens, from Voyage's pricing page. */
const pricePerMillion = {
  'voyage-4': 0.06,
  'voyage-4-lite': 0.02,
  'rerank-2.5-lite': 0.02,
} as const;

type VoyageModel = keyof typeof pricePerMillion;

// Far under the API's 1,000 inputs and 320k tokens: a chapter's moments and chunks fit in one.
const batchSize = 100;

const requestTimeoutMs = 15_000;

// A close makes three or four requests within seconds, and an account without a payment method allows
// three a minute: waiting a minute at most saves the day's memory and costs the 15-minute job little.
const rateLimitBudgetMs = 60_000;
const defaultRateLimitWaitMs = 20_000;

const retryAfterMs = (reply: Response) => {
  const seconds = Number(reply.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultRateLimitWaitMs;
};

/**
 * Creates the Voyage client. It never logs what it embeds, only the status of a failed request: the
 * texts come from what players wrote.
 */
export function createVoyage(options: VoyageOptions): Voyage {
  const send = options.fetch ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const post = async <Schema extends z.ZodType>(
    path: string,
    body: Record<string, unknown>,
    schema: Schema,
  ): Promise<z.infer<Schema> | undefined> => {
    // A rate limit is waited out within its budget; a failing service gets one more try at once.
    let waited = 0;
    let failures = 0;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const reply = await send(`${apiUrl}/${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        if (!reply.ok) {
          await reply.body?.cancel();
          console.warn({ message: 'voyage request failed', path, status: reply.status, attempt });
          if (reply.status === 429) {
            const wait = retryAfterMs(reply);
            if (waited + wait > rateLimitBudgetMs) return undefined;
            waited += wait;
            await sleep(wait);
            continue;
          }
          failures += 1;
          if (reply.status >= 500 && failures < 2) continue;
          return undefined;
        }
        const parsed = schema.safeParse(await reply.json());
        if (parsed.success) return parsed.data;
        console.warn({ message: 'voyage reply invalid', path });
        return undefined;
      } catch (error) {
        console.warn({
          message: 'voyage request failed',
          path,
          error: error instanceof Error ? error.name : 'unknown',
          attempt,
        });
        failures += 1;
        if (failures >= 2) return undefined;
      }
    }
  };

  const ledgerRow = (
    name: AiFunction,
    model: VoyageModel,
    tokens: number,
    startedAt: number,
  ): AiUsage => ({
    workspace: options.workspace,
    function: name,
    promptVersion: 'none',
    model,
    inputTokens: tokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    costUsd: (tokens * pricePerMillion[model]) / 1_000_000,
    latencyMs: Date.now() - startedAt,
    refusalCategory: null,
  });

  const embed = async (
    name: 'embed_documents' | 'embed_query',
    model: 'voyage-4' | 'voyage-4-lite',
    inputType: 'document' | 'query',
    texts: readonly string[],
  ): Promise<VoyageResult<number[][]>> => {
    const vectors: number[][] = [];
    const usage: AiUsage[] = [];
    for (let start = 0; start < texts.length; start += batchSize) {
      const input = texts.slice(start, start + batchSize);
      const startedAt = Date.now();
      const reply = await post(
        'embeddings',
        { model, input, input_type: inputType, output_dimension: EMBEDDING_DIMENSIONS },
        voyageEmbeddingsReplySchema,
      );
      if (reply === undefined) return { ok: false, error: 'technical', usage };
      usage.push(ledgerRow(name, model, reply.usage.total_tokens, startedAt));

      const byIndex = new Map(reply.data.map(({ index, embedding }) => [index, embedding]));
      for (let index = 0; index < input.length; index += 1) {
        const embedding = byIndex.get(index);
        if (embedding === undefined) {
          console.warn({ message: 'voyage reply invalid', path: 'embeddings' });
          return { ok: false, error: 'technical', usage };
        }
        vectors.push(embedding);
      }
    }
    return { ok: true, value: vectors, usage };
  };

  return {
    embedDocuments: (texts) => embed('embed_documents', 'voyage-4', 'document', texts),
    embedQueries: (texts) => embed('embed_query', 'voyage-4-lite', 'query', texts),
    rerank: async (query, documents, topK) => {
      const startedAt = Date.now();
      const model = 'rerank-2.5-lite';
      const reply = await post(
        'rerank',
        { model, query, documents, top_k: topK },
        voyageRerankReplySchema,
      );
      if (reply === undefined) return { ok: false, error: 'technical', usage: [] };
      return {
        ok: true,
        value: reply.data.map(({ index }) => index),
        usage: [ledgerRow('rerank', model, reply.usage.total_tokens, startedAt)],
      };
    },
  };
}
