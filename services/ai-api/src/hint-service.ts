import { createGameStore, requestHint } from '@cronista/engine';
import { createBibleLoader } from '@cronista/engine/bible';
import { createNarrator, type FlushTraces, startTracing } from '@cronista/narrator';
import type { ParametersResult } from '@cronista/parameters';

import type { HintAnswer } from './handler.ts';

/** The SSM parameters a hint needs. */
export type HintKey = 'anthropic' | 'langfuse' | 'langfusePublic' | 'supabase';

/** What {@link createHintService} needs. */
export interface HintServiceOptions {
  readonly readKeys: () => Promise<ParametersResult<HintKey>>;
  readonly supabaseUrl: string;
  readonly langfuseUrl: string;
  /** Reads a season's bible from the private bucket. */
  readonly readBible: (seasonNumber: number) => Promise<string | undefined>;
}

/**
 * Gives a hint with what the keys in SSM open. It reads them on each request, from the extension's
 * cache, so that a rotated key takes over by itself; only tracing starts once per Lambda environment.
 */
export function createHintService(options: HintServiceOptions): {
  readonly requestHint: (userId: string) => Promise<HintAnswer>;
  readonly flushTraces: FlushTraces;
} {
  const loadBible = createBibleLoader(options.readBible);
  let flushTraces: FlushTraces | undefined;

  return {
    flushTraces: () => flushTraces?.() ?? Promise.resolve(),
    requestHint: async (userId) => {
      const keys = await options.readKeys();
      if (!keys.ok) {
        console.warn({ message: 'provider keys unreadable', unreadable: keys.error.unreadable });
        return { ok: false, error: 'providers_not_configured' };
      }
      flushTraces ??= startTracing({
        publicKey: keys.value.langfusePublic,
        secretKey: keys.value.langfuse,
        baseUrl: options.langfuseUrl,
        environment: 'production',
      });
      return requestHint(
        {
          store: createGameStore({ url: options.supabaseUrl, secretKey: keys.value.supabase }),
          narrator: createNarrator({ apiKey: keys.value.anthropic, workspace: 'game-prod' }),
          loadBible,
          clock: () => new Date(),
        },
        { userId },
      );
    },
  };
}
