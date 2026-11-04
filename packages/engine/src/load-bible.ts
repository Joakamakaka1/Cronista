import { type Bible, bibleSchema, type Result } from '@cronista/core';
import { parse } from 'yaml';

/** A season's bible, or that it could not be read. Why goes to the logs, never its text. */
export type BibleResult = Result<Bible, 'bible_unavailable'>;

/** Reads the bible of a season by its number. */
export type LoadBible = (seasonNumber: number) => Promise<BibleResult>;

/**
 * Creates a loader over a source of YAML text: the private bucket in production, the repo's invented
 * file locally. A bible that loads stays in memory: play never changes it, and a Lambda environment
 * lives a few hours at most.
 *
 * @param fetchText - Reads a season's file, answering `undefined` when it cannot.
 */
export function createBibleLoader(
  fetchText: (seasonNumber: number) => Promise<string | undefined>,
): LoadBible {
  const loaded = new Map<number, Bible>();

  return async (seasonNumber) => {
    const known = loaded.get(seasonNumber);
    if (known !== undefined) return { ok: true, value: known };

    const text = await fetchText(seasonNumber);
    if (text === undefined) {
      console.warn({ message: 'bible unreadable', seasonNumber });
      return { ok: false, error: 'bible_unavailable' };
    }

    let document: unknown;
    try {
      document = parse(text);
    } catch (error) {
      // Only the class: the parser's message quotes the file, which holds real data.
      const name = error instanceof Error ? error.name : 'unknown';
      console.warn({ message: 'bible is not valid YAML', seasonNumber, error: name });
      return { ok: false, error: 'bible_unavailable' };
    }

    const bible = bibleSchema.safeParse(document);
    if (!bible.success) {
      // Paths and codes only, for the same reason.
      const issues = bible.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
      }));
      console.warn({ message: 'bible fails its schema', seasonNumber, issues });
      return { ok: false, error: 'bible_unavailable' };
    }

    loaded.set(seasonNumber, bible.data);
    return { ok: true, value: bible.data };
  };
}
