import {
  CLOSING_DEADLINE_MINUTE_OF_DAY,
  GAME_TIME_ZONE,
  gameDayOf,
  type GameLoopCheck,
  OPENING_DEADLINE_MINUTE_OF_DAY,
} from '@cronista/core';

/** What the game-loop check depends on, so tests can replace it. */
export interface GameLoopCheckDependencies {
  /** How many times `job` reported its completion between two instants. */
  readonly countCompletions: (job: GameLoopCheck['job'], from: Date, to: Date) => Promise<number>;
  readonly publishAlert: (subject: string, message: string) => Promise<void>;
  /** Tells the alarm that watches these checks that one ran. */
  readonly reportChecked: () => void;
}

const millisecondsPerHour = 3_600_000;

const clockOf = (minuteOfDay: number) =>
  `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;

const deadlines = {
  'open-day': { missed: 'was not opened', deadline: clockOf(OPENING_DEADLINE_MINUTE_OF_DAY) },
  'close-day': { missed: 'was not closed', deadline: clockOf(CLOSING_DEADLINE_MINUTE_OF_DAY) },
} as const;

/**
 * Creates the check that a job of the day reported by its deadline. Scheduler sends it at 08:30 and
 * 22:30 game time, which covers what no error alarm sees: a schedule that never fired and a job that
 * ended without publishing.
 *
 * @remarks
 * It looks only at the hour before the deadline: the job runs 30 minutes earlier, so a report from
 * the day before never counts. A failure throws, so that the queue retries the check.
 */
export function createGameLoopCheck(
  dependencies: GameLoopCheckDependencies,
): (check: GameLoopCheck) => Promise<void> {
  return async ({ job, scheduledTime }) => {
    const deadline = new Date(scheduledTime);
    const day = gameDayOf(deadline);
    const completions = await dependencies.countCompletions(
      job,
      new Date(deadline.getTime() - millisecondsPerHour),
      deadline,
    );
    console.info({ message: 'game loop check', job, day, completions });

    if (completions < 1) {
      const expected = deadlines[job];
      await dependencies.publishAlert(
        `Cronista: the day ${expected.missed}`,
        [
          `The ${job} job of ${day} had not reported by ${expected.deadline} (${GAME_TIME_ZONE}).`,
          '',
          'Either its schedule never fired or the job ended without finishing its work. Look at the ai-worker logs, then run the job by hand: "The workers in production" in docs/development.md.',
        ].join('\n'),
      );
    }
    dependencies.reportChecked();
  };
}
