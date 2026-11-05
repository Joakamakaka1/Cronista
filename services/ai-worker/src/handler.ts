import { gameDayOf, type WorkerJob, workerJobSchema } from '@cronista/core';
import type { CloseDayResult, OpenDayResult } from '@cronista/engine';
import type { ParametersResult } from '@cronista/parameters';

import type { PingResult } from './keep-alive.ts';

/** The keys the `ai-worker` reads from SSM for the day's jobs. */
export type Provider = 'anthropic' | 'voyage' | 'langfuse' | 'langfusePublic' | 'supabase';

/** What the ai-worker handler depends on, so tests can replace it. */
export interface AiWorkerDependencies {
  readonly readProviderKeys: () => Promise<ParametersResult<Provider>>;
  readonly pingDatabase: () => Promise<PingResult>;
  /** The game engine's `openDay`, with its store, narrator and bible. */
  readonly openDay: (day: string) => Promise<OpenDayResult>;
  /** The game engine's `closeDay`, with its store, narrator and bible. */
  readonly closeDay: (day: string) => Promise<CloseDayResult>;
  /** Sends the traces still waiting: the environment may freeze as soon as the handler returns. */
  readonly flushTraces: () => Promise<void>;
  /** Tells the check at the job's deadline that the job did all its work: call it last. */
  readonly reportJobCompleted: (job: Exclude<WorkerJob['job'], 'keep-alive'>) => void;
}

/** What a run returns, which a manual invocation prints. */
export interface JobReport {
  readonly job: WorkerJob['job'];
  /** The game day the job was scheduled for (`YYYY-MM-DD`, game time). */
  readonly day: string;
  readonly status: string;
}

/**
 * Creates the ai-worker handler, which EventBridge Scheduler invokes to open the day at 08:00, close
 * it at 22:00 and keep the database awake at 04:00. With no active season, opening and closing spend
 * nothing and report completion, so the deadline checks stay quiet until the game starts.
 *
 * @remarks
 * The game day comes from the scheduled time, never from the clock, so a retry acts on the same day.
 * An outage throws, so that Lambda retries the job and the errors alarm fires. A chapter postponed or a
 * day not opened for what the model answered does not throw, because a retry would pay for the same
 * refusal: it reports no completion, and the check at the job's deadline raises the alert.
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

    try {
      const outcome =
        job === 'open-day' ? await openDay(dependencies, day) : await closeDay(dependencies, day);
      if (outcome.completed) {
        console.info({ message: 'job finished', job, day, status: outcome.status });
        dependencies.reportJobCompleted(job);
      } else {
        console.warn({ message: 'job did not finish', job, day, status: outcome.status });
      }
      return { job, day, status: outcome.status };
    } finally {
      await dependencies.flushTraces();
    }
  };
}

interface JobOutcome {
  readonly status: string;
  /** Whether the job did all its work, which is what its deadline check waits for. */
  readonly completed: boolean;
}

async function openDay(dependencies: AiWorkerDependencies, day: string): Promise<JobOutcome> {
  const opened = await dependencies.openDay(day);
  if (opened.ok) return { status: opened.value, completed: true };
  if (
    opened.error === 'store_unavailable' ||
    opened.error === 'bible_unavailable' ||
    opened.error === 'situation_unavailable'
  ) {
    throw new Error(`The ai-worker could not open the day: ${opened.error}.`);
  }
  return { status: opened.error, completed: false };
}

async function closeDay(dependencies: AiWorkerDependencies, day: string): Promise<JobOutcome> {
  const closed = await dependencies.closeDay(day);
  if (!closed.ok) {
    if (closed.error === 'store_unavailable') {
      throw new Error(`The ai-worker could not close the day: ${closed.error}.`);
    }
    return { status: closed.error, completed: false };
  }
  if (closed.value.status !== 'postponed') return { status: closed.value.status, completed: true };

  const { reason } = closed.value;
  // A close run again publishes a postponed chapter, so an outage gets Lambda's retries.
  if (reason === 'bible_unavailable' || reason.endsWith('_technical')) {
    throw new Error(`The ai-worker could not close the day: ${reason}.`);
  }
  return { status: `postponed: ${reason}`, completed: false };
}
