import {
  checkSpend,
  closeDay,
  type CloseDayResult,
  createGameStore,
  openDay,
  type OpenDayResult,
  type GameAlert,
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
  /** Sends a message to the account alerts topic. */
  readonly publishAlert: (subject: string, message: string) => Promise<void>;
  /** Tells the alarm that watches these that the owner could not be told something. */
  readonly reportOwnerNotTold: () => void;
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
  readonly checkSpend: () => Promise<void>;
  readonly flushTraces: FlushTraces;
} {
  const loadBible = createBibleLoader(options.readBible);
  let flushTraces: FlushTraces | undefined;

  // A failure to tell the owner never fails a job. Its own alarm reports it, because the deadline
  // checks stay quiet for a job that finished, as with the reserve situation or the spend alerts.
  const alert = async ({ subject, message }: GameAlert) => {
    try {
      await options.publishAlert(subject, message);
      return true;
    } catch (error) {
      console.error({
        message: 'alert not sent',
        subject,
        error: error instanceof Error ? error.name : 'unknown',
      });
      options.reportOwnerNotTold();
      return false;
    }
  };

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
      alert,
    };
  };

  return {
    openDay: async (day) => openDay(await dependencies(), day),
    closeDay: async (day) => closeDay(await dependencies(), day),
    checkSpend: async () => {
      try {
        const checked = await checkSpend(await dependencies());
        if (!checked.ok) {
          console.warn({ message: 'spend not checked', error: checked.error });
          options.reportOwnerNotTold();
        }
      } catch (error) {
        console.warn({
          message: 'spend not checked',
          error: error instanceof Error ? error.name : 'unknown',
        });
        options.reportOwnerNotTold();
      }
    },
    flushTraces: () => flushTraces?.() ?? Promise.resolve(),
  };
}
