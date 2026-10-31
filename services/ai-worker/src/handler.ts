import { gameDayOf, type WorkerJob, workerJobSchema } from '@cronista/core';
import type { ParametersResult } from '@cronista/parameters';

import type { PingResult } from './keep-alive.ts';

/** The AI providers whose API key the `ai-worker` reads from SSM. */
export type Provider = 'anthropic' | 'voyage' | 'langfuse';

/** What the ai-worker handler depends on, so tests can replace it. */
export interface AiWorkerDependencies {
  readonly readProviderKeys: () => Promise<ParametersResult<Provider>>;
  readonly pingDatabase: () => Promise<PingResult>;
}

/** What a run returns, which a manual invocation prints. */
export interface JobReport {
  readonly job: WorkerJob['job'];
  /** The game day the job was scheduled for (`YYYY-MM-DD`, game time). */
  readonly day: string;
  readonly status: 'not_implemented' | 'awake';
}

/**
 * Creates the ai-worker handler, which EventBridge Scheduler invokes to open the day at 08:00, close
 * it at 22:00 and keep the database awake at 04:00. Opening and closing are not implemented: the
 * handler checks the job and that the provider keys are readable, and reports the game day it would
 * act on.
 *
 * @remarks
 * The game day comes from the scheduled time, never from the clock, so a retry acts on the same
 * day. A failure throws, so that Lambda retries the job and the errors alarm fires.
 */
export function createHandler(
  dependencies: AiWorkerDependencies,
): (event: unknown) => Promise<JobReport> {
  return async (event) => {
    const parsed = workerJobSchema.safeParse(event);
    if (!parsed.success) {
      // Paths and codes only: a hand-made invocation could carry anything.
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
      }));
      console.error({ message: 'invalid job', issues });
      throw new Error('The ai-worker received an invalid job.');
    }
    const { job, scheduledTime } = parsed.data;
    const day = gameDayOf(new Date(scheduledTime));

    if (job === 'keep-alive') {
      const ping = await dependencies.pingDatabase();
      if (!ping.ok) {
        console.error({ message: 'database ping failed', job, day, ...ping.error });
        throw new Error('The ai-worker could not reach the database.');
      }
      console.info({ message: 'database awake', job, day });
      return { job, day, status: 'awake' };
    }

    const keys = await dependencies.readProviderKeys();
    if (!keys.ok) {
      console.error({
        message: 'provider keys unreadable',
        job,
        day,
        unreadable: keys.error.unreadable,
      });
      throw new Error('The ai-worker could not read its provider keys.');
    }

    console.info({ message: 'job not implemented', job, day });
    return { job, day, status: 'not_implemented' };
  };
}
