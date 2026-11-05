/** A message to the owner. It carries days, codes and numbers, never anything a player wrote. */
export interface GameAlert {
  readonly subject: string;
  readonly message: string;
}

/**
 * Sends an alert to the owner, and answers whether it went out. It never throws: a failure to tell the
 * owner never fails a job, and the deadline checks are still there.
 */
export type RaiseAlert = (alert: GameAlert) => Promise<boolean>;

const manualRuns =
  'Fix the cause, then run the jobs by hand: "A postponed chapter" in docs/development.md.';

/** The alert for a chapter that could not be published. */
export function chapterPostponedAlert(day: string, reason: string): GameAlert {
  const limited = reason.endsWith('_spend_limit');
  return {
    subject: limited
      ? 'Cronista: the workspace spend limit postponed a chapter'
      : 'Cronista: a chapter was postponed',
    message: [
      `The chapter of ${day} was postponed: ${reason}. Players read the newspaper's message, and nothing moved.`,
      'The opening job tries it again first, and the next day stays closed until it is published.',
      '',
      manualRuns,
    ].join('\n'),
  };
}

/** The alert for a day that stays closed because the chapter before it is still pending. */
export function dayNotOpenedAlert(day: string, pendingDay: string, reason: string): GameAlert {
  return {
    subject: 'Cronista: the day did not open, a chapter is pending',
    message: [
      `The day ${day} did not open: the chapter of ${pendingDay} failed again (${reason}).`,
      "The game waits for you, and players still read the newspaper's message.",
      '',
      manualRuns,
    ].join('\n'),
  };
}

/** The alert for a season that ended while its last days could not open, so with no finale. */
export function noFinaleAlert(lastDay: string, pendingDay: string): GameAlert {
  return {
    subject: 'Cronista: a season ended with no finale',
    message: [
      `The chapter of ${pendingDay} is published now, but ${lastDay}, the season's last day, never opened. So there is no finale yet: open debts have not moved and nobody has won.`,
      '',
      `Run the opening of ${lastDay} and then its close by hand: "A postponed chapter" in docs/development.md.`,
    ].join('\n'),
  };
}

/** The alert for a chapter whose moments will never reach memory, so that later ones can. */
export function memorySkippedAlert(day: string, reason: string): GameAlert {
  return {
    subject: 'Cronista: a chapter was left out of memory',
    message: `The moments of the chapter of ${day} could not be written (${reason}), and trying again would give the same answer. The chapter stands, and its chunks still let the narrator find it; later chapters go on. Look at the traces and the ai-worker logs.`,
  };
}

/** The alert for a day opened with the reserve situation. */
export function reserveSituationAlert(day: string, reason: string): GameAlert {
  return {
    subject: 'Cronista: the reserve situation opened the day',
    message: `The narrator could not write the situation of ${day} (${reason}), so the newspaper's fixed text opened the day. Players can play as usual. Look at the traces and the ai-worker logs.`,
  };
}
