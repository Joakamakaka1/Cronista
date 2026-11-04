import { createBibleLoader, createGameStore, requestHint } from '@cronista/engine';
import { createNarrator, startTracing } from '@cronista/narrator';
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
 * Builds what a hint needs the first time one is asked for, because the keys come from SSM, and keeps
 * it for the life of the Lambda environment.
 */
export function createHintService(options: HintServiceOptions): {
  readonly requestHint: (userId: string) => Promise<HintAnswer>;
  readonly flushTraces: () => Promise<void>;
} {
  const loadBible = createBibleLoader(options.readBible);
  let flushTraces: () => Promise<void> = () => Promise.resolve();
  let built:
    | {
        readonly store: ReturnType<typeof createGameStore>;
        readonly narrator: ReturnType<typeof createNarrator>;
      }
    | undefined;

  return {
    flushTraces: () => flushTraces(),
    requestHint: async (userId) => {
      if (built === undefined) {
        const keys = await options.readKeys();
        if (!keys.ok) {
          console.warn({ message: 'provider keys unreadable', unreadable: keys.error.unreadable });
          return { ok: false, error: 'providers_not_configured' };
        }
        flushTraces = startTracing({
          publicKey: keys.value.langfusePublic,
          secretKey: keys.value.langfuse,
          baseUrl: options.langfuseUrl,
          environment: 'production',
        });
        built = {
          store: createGameStore({ url: options.supabaseUrl, secretKey: keys.value.supabase }),
          narrator: createNarrator({ apiKey: keys.value.anthropic, workspace: 'game-prod' }),
        };
      }
      return requestHint({ ...built, loadBible, clock: () => new Date() }, { userId });
    },
  };
}
