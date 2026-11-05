import type { ChapterSummary, Memory, RememberedMoment } from '@cronista/core';

import type { SeasonMoment } from './memory-store.ts';

/** How many moments each character sheet holds. */
export const SHEET_MOMENTS = 3;

/** How many running jokes the bundle holds. */
export const ACTIVE_JOKES = 5;

const remembered = ({ day, text }: SeasonMoment): RememberedMoment => ({ day, text });

const newestFirst = (first: SeasonMoment, second: SeasonMoment) =>
  second.day.localeCompare(first.day) || second.id - first.id;

/**
 * The fixed memory bundle every resolve and narrate gets: each character's most important current
 * moments, the jokes told most recently, and the summary that bridges to the last full chapters.
 */
export function buildFixedBundle(input: {
  readonly moments: readonly SeasonMoment[];
  /** The season's nicknames, in canon's order. */
  readonly characters: readonly string[];
  readonly earlierSummary: ChapterSummary | null;
}): Omit<Memory, 'recalled'> {
  const current = input.moments.filter((moment) => moment.current);

  const characterSheets = input.characters.flatMap((nickname) => {
    const moments = current
      .filter(({ characters }) => characters.includes(nickname))
      .sort((first, second) => second.importance - first.importance || newestFirst(first, second))
      .slice(0, SHEET_MOMENTS)
      .map(remembered);
    return moments.length === 0 ? [] : [{ nickname, moments }];
  });

  // A joke's last telling counts even when that moment was superseded: it was still told.
  const lastTold = new Map<string, string>();
  for (const { joke, day } of input.moments) {
    if (joke !== null && day > (lastTold.get(joke) ?? '')) lastTold.set(joke, day);
  }
  const activeJokes = [...lastTold]
    .sort(([, first], [, second]) => second.localeCompare(first))
    .flatMap(([joke]) => {
      // Only a current moment: a superseded one tells a fact that is no longer true.
      const latest = current.filter((moment) => moment.joke === joke).sort(newestFirst)[0];
      return latest === undefined ? [] : [{ joke, moment: remembered(latest) }];
    })
    .slice(0, ACTIVE_JOKES);

  return { characterSheets, activeJokes, earlierSummary: input.earlierSummary };
}
