import {
  closeDay,
  type CloseDayResult,
  createGameStore,
  openDay,
  type OpenDayResult,
} from '@cronista/engine';
import { createBibleLoader } from '@cronista/engine/bible';
import { createNarrator, type FlushTraces, startTracing } from '@cronista/narrator';
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
 * Runs the day's jobs with what the keys in SSM open. It reads them on each job, from the extension's
 * cache, so that a rotated key takes over by itself; only tracing starts once per Lambda environment.
 *
 * @throws When the keys cannot be read. The handler has just read them, so it is an outage.
 */
export function createGameJobs(options: GameJobsOptions): {
  readonly openDay: (day: string) => Promise<OpenDayResult>;
  readonly closeDay: (day: string) => Promise<CloseDayResult>;
  readonly flushTraces: FlushTraces;
} {
  const loadBible = createBibleLoader(options.readBible);
  let flushTraces: FlushTraces | undefined;

  const dependencies = async () => {
    const keys = await options.readKeys();
    if (!keys.ok) throw new Error('The ai-worker could not read its provider keys.');
    flushTraces ??= startTracing({
      publicKey: keys.value.langfusePublic,
      secretKey: keys.value.langfuse,
      baseUrl: options.langfuseUrl,
      environment: 'production',
    });
    return {
      store: createGameStore({ url: options.supabaseUrl, secretKey: keys.value.supabase }),
      narrator: createNarrator({ apiKey: keys.value.anthropic, workspace: 'game-prod' }),
      loadBible,
      clock: () => new Date(),
    };
  };

  return {
    openDay: async (day) => openDay(await dependencies(), day),
    closeDay: async (day) => closeDay(await dependencies(), day),
    flushTraces: () => flushTraces?.() ?? Promise.resolve(),
  };
}
