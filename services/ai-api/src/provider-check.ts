import { anthropicMessageReplySchema, voyageEmbeddingReplySchema } from '@cronista/core';
import type { ParametersResult } from '@cronista/parameters';
import type { z } from 'zod';

import type { Provider } from './handler.ts';

/** The SSM parameters the provider check reads: the provider keys plus Langfuse's public key. */
export type ProviderKey = Provider | 'langfusePublic';

/** How one provider answered: `ok`, or an error class that never carries a key or a reply. */
export type ProviderOutcome = 'ok' | 'timeout' | 'unreachable' | 'invalid_reply' | `http_${number}`;

/** What a provider check returns, which `aws lambda invoke` prints. */
export type ProviderCheckReport =
  | {
      readonly status: 'checked';
      readonly anthropic: ProviderOutcome;
      readonly voyage: ProviderOutcome;
      readonly langfuse: ProviderOutcome;
      /** The trace to look for in Langfuse. */
      readonly traceId: string;
    }
  | { readonly status: 'keys_unreadable'; readonly unreadable: readonly ProviderKey[] };

/** What {@link createProviderCheck} needs. */
export interface ProviderCheckOptions {
  readonly readProviderKeys: () => Promise<ParametersResult<ProviderKey>>;
  /** Base URL of the Langfuse project's region (`https://cloud.langfuse.com` for the EU). */
  readonly langfuseUrl: string;
  /** Replaces the global `fetch` in tests. */
  readonly fetch?: typeof fetch;
}

// Key read (2 s), Anthropic and Voyage in parallel, then Langfuse: within the 20 s of the Lambda.
const providerTimeoutMs = 6000;
const langfuseTimeoutMs = 5000;

/**
 * Creates the provider check: one Haiku call, one Voyage embedding and one Langfuse trace, which
 * prove the keys, the role and the network path from the deployed `ai-api`.
 *
 * @remarks
 * The prompt and the embedded string are fixed and hold no player data.
 */
export function createProviderCheck(
  options: ProviderCheckOptions,
): () => Promise<ProviderCheckReport> {
  const send = options.fetch ?? fetch;

  return async () => {
    const keys = await options.readProviderKeys();
    if (!keys.ok) return { status: 'keys_unreadable', unreadable: keys.error.unreadable };
    const startedAt = Date.now();

    const [anthropic, voyage] = await Promise.all([
      outcomeOf(
        () =>
          send('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': keys.value.anthropic,
              'anthropic-version': '2026-10-21',
            },
            body: JSON.stringify({
              model: 'claude-haiku-5-5',
              max_tokens: 16,
              output_config: { effort: 'low' },
              messages: [{ role: 'user', content: 'Responde solo «ok».' }],
            }),
            signal: AbortSignal.timeout(providerTimeoutMs),
          }),
        anthropicMessageReplySchema,
      ),
      outcomeOf(
        () =>
          send('https://api.voyageai.com/v1/embeddings', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${keys.value.voyage}`,
            },
            body: JSON.stringify({
              input: ['Cronista'],
              model: 'voyage-4-lite',
              input_type: 'query',
            }),
            signal: AbortSignal.timeout(providerTimeoutMs),
          }),
        voyageEmbeddingReplySchema,
      ),
    ]);

    // OTLP/JSON ids are lowercase hex: 16 bytes for the trace, 8 for the span.
    const traceId = crypto.randomUUID().replaceAll('-', '');
    const spanId = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
    const attribute = (key: string, value: string) => ({ key, value: { stringValue: value } });
    const langfuse = await outcomeOf(() =>
      send(`${options.langfuseUrl}/api/public/otel/v1/traces`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${btoa(`${keys.value.langfusePublic}:${keys.value.langfuse}`)}`,
          // Without it, Langfuse may take up to 10 minutes to show the trace.
          'x-langfuse-ingestion-version': '4',
        },
        body: JSON.stringify({
          resourceSpans: [
            {
              resource: { attributes: [attribute('service.name', 'ai-api')] },
              scopeSpans: [
                {
                  scope: { name: 'cronista' },
                  spans: [
                    {
                      traceId,
                      spanId,
                      name: 'provider-check',
                      kind: 1,
                      startTimeUnixNano: `${startedAt}000000`,
                      endTimeUnixNano: `${Date.now()}000000`,
                      attributes: [
                        attribute('langfuse.trace.name', 'provider-check'),
                        attribute('langfuse.trace.metadata.anthropic', anthropic),
                        attribute('langfuse.trace.metadata.voyage', voyage),
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(langfuseTimeoutMs),
      }),
    );

    return { status: 'checked', anthropic, voyage, langfuse, traceId };
  };
}

/** Sends one request and reduces the reply to an outcome; without a schema, any 2xx is `ok`. */
async function outcomeOf(
  request: () => Promise<Response>,
  replySchema?: z.ZodType,
): Promise<ProviderOutcome> {
  try {
    const reply = await request();
    if (!reply.ok || replySchema === undefined) {
      // Releases the connection now instead of when the unread body is collected.
      await reply.body?.cancel();
      return reply.ok ? 'ok' : `http_${reply.status}`;
    }
    const body: unknown = await reply.json();
    return replySchema.safeParse(body).success ? 'ok' : 'invalid_reply';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout';
    return error instanceof SyntaxError ? 'invalid_reply' : 'unreachable';
  }
}
