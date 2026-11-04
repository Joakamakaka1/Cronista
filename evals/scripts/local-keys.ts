/** How one provider answered: `ok`, or a class that never carries a key or a reply. */
export type KeyOutcome =
  'ok' | 'timeout' | 'unreachable' | `http_${number}` | `missing ${LocalKeyName}`;

/** The variables that local commands read: "Local secrets" in `docs/development.md` lists them. */
export type LocalKeyName =
  'ANTHROPIC_API_KEY' | 'VOYAGE_API_KEY' | 'LANGFUSE_PUBLIC_KEY' | 'LANGFUSE_SECRET_KEY';

/** One outcome per provider. */
export interface LocalKeysReport {
  readonly anthropic: KeyOutcome;
  readonly voyage: KeyOutcome;
  readonly langfuse: KeyOutcome;
}

const timeoutMs = 10_000;

/**
 * Proves that the local keys arrived and work: one Haiku call of a few tokens, one Voyage embedding
 * of a fixed word and one read of the Langfuse project, which writes no trace.
 *
 * @remarks
 * These calls use `fetch` like `ai-api`'s provider check, so a check of keys adds no dependency.
 */
export async function checkLocalKeys(
  environment: Readonly<Record<string, string | undefined>>,
  send: typeof fetch,
): Promise<LocalKeysReport> {
  const anthropicKey = environment.ANTHROPIC_API_KEY;
  const voyageKey = environment.VOYAGE_API_KEY;
  const langfusePublic = environment.LANGFUSE_PUBLIC_KEY;
  const langfuseSecret = environment.LANGFUSE_SECRET_KEY;

  const [anthropic, voyage, langfuse] = await Promise.all([
    anthropicKey
      ? outcomeOf(() =>
          send('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': anthropicKey,
              'anthropic-version': '2026-10-21',
            },
            body: JSON.stringify({
              model: 'claude-haiku-5-5',
              max_tokens: 16,
              output_config: { effort: 'low' },
              messages: [{ role: 'user', content: 'Responde solo «ok».' }],
            }),
            signal: AbortSignal.timeout(timeoutMs),
          }),
        )
      : ('missing ANTHROPIC_API_KEY' as const),
    voyageKey
      ? outcomeOf(() =>
          send('https://api.voyageai.com/v1/embeddings', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${voyageKey}`,
            },
            body: JSON.stringify({
              input: ['Cronista'],
              model: 'voyage-4-lite',
              input_type: 'query',
            }),
            signal: AbortSignal.timeout(timeoutMs),
          }),
        )
      : ('missing VOYAGE_API_KEY' as const),
    !langfusePublic
      ? ('missing LANGFUSE_PUBLIC_KEY' as const)
      : !langfuseSecret
        ? ('missing LANGFUSE_SECRET_KEY' as const)
        : outcomeOf(() =>
            send('https://cloud.langfuse.com/api/public/projects', {
              headers: { authorization: `Basic ${btoa(`${langfusePublic}:${langfuseSecret}`)}` },
              signal: AbortSignal.timeout(timeoutMs),
            }),
          ),
  ]);

  return { anthropic, voyage, langfuse };
}

/** Sends one request and reduces the reply to an outcome, dropping its body and any error text. */
async function outcomeOf(request: () => Promise<Response>): Promise<KeyOutcome> {
  try {
    const reply = await request();
    // Releases the connection now instead of when the unread body is collected.
    await reply.body?.cancel();
    return reply.ok ? 'ok' : `http_${reply.status}`;
  } catch (error) {
    return error instanceof DOMException && error.name === 'TimeoutError'
      ? 'timeout'
      : 'unreachable';
  }
}
