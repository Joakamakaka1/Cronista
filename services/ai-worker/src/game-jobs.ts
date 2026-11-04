import {
  closeDay,
  type CloseDayResult,
  createBibleLoader,
  createGameStore,
  openDay,
  type OpenDayResult,
} from '@cronista/engine';
import { createNarrator, startTracing } from '@cronista/narrator';
import type { ParametersResult } from '@cronista/parameters';

import type { Provider } from './handler.ts';

/** What {@link createGameJobs} needs. */
export interface GameJobsOptions {
  readonly readKeys: () => Promise<ParametersResult<Provider>>;
  readonly supabaseUrl: string;
  readonly langfuseUrl: string;
  /** Reads a season's bible from the private bucket. */
  readonly readBible: (seasonNumber: number) => Promise<string | undefined>;
}

/**
 * Builds what the day's jobs need the first time one runs, because the keys come from SSM, and keeps
 * it for the life of the Lambda environment.
 *
 * @throws When the keys cannot be read. The handler has just read them, so it is an outage.
 */
export function createGameJobs(options: GameJobsOptions): {
  readonly openDay: (day: string) => Promise<OpenDayResult>;
  readonly closeDay: (day: string) => Promise<CloseDayResult>;
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

  const dependencies = async () => {
    if (built === undefined) {
      const keys = await options.readKeys();
      if (!keys.ok) throw new Error('The ai-worker could not read its provider keys.');
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
    return { ...built, loadBible, clock: () => new Date() };
  };

  return {
    openDay: async (day) => openDay(await dependencies(), day),
    closeDay: async (day) => closeDay(await dependencies(), day),
    flushTraces: () => flushTraces(),
  };
}
