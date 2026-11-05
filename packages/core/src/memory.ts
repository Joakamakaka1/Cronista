import type { ComparisonOutput, ExtractedMoment } from './schemas/memory-output.ts';

// -----------------------------------------------------------------------------
// What the narrator recalls
// -----------------------------------------------------------------------------

/** A moment as the narrator reads it: untrusted text, derived from what players wrote. */
export interface RememberedMoment {
  readonly day: string;
  readonly text: string;
}

/** What a character's season has made of it: its most important current moments. */
export interface CharacterSheet {
  readonly nickname: string;
  readonly moments: readonly RememberedMoment[];
}

/** A running joke and the latest moment that told it. */
export interface ActiveJoke {
  readonly joke: string;
  readonly moment: RememberedMoment;
}

/** A chapter's summary, written when its moments were extracted. */
export interface ChapterSummary {
  readonly day: string;
  readonly summary: string;
}

/**
 * What the narrator recalls on a day beyond canon and the last chapters: the fixed bundle, which every
 * call gets, and the moments retrieval found for today. Canon wins over all of it.
 */
export interface Memory {
  readonly characterSheets: readonly CharacterSheet[];
  readonly activeJokes: readonly ActiveJoke[];
  /** The summary of the chapter just before the last full ones, which bridges to them. */
  readonly earlierSummary: ChapterSummary | null;
  /** The hybrid top-k over today's situation and actions. */
  readonly recalled: readonly RememberedMoment[];
}

/** No memory: the first days of a season, or a narrator call that needs none. */
export const NO_MEMORY: Memory = {
  characterSheets: [],
  activeJokes: [],
  earlierSummary: null,
  recalled: [],
};

// -----------------------------------------------------------------------------
// Writing memory
// -----------------------------------------------------------------------------

const normalized = (text: string) => text.trim().replace(/\s+/g, ' ');

/**
 * Cleans the moments the narrator extracted: characters canon does not know are dropped, a known joke
 * label is reused whatever its case, and a moment that repeats another is left out.
 */
export function validateMoments(
  moments: readonly ExtractedMoment[],
  known: { readonly characters: readonly string[]; readonly jokes: readonly string[] },
): ExtractedMoment[] {
  const characters = new Set(known.characters);
  const jokes = new Map(known.jokes.map((joke) => [normalized(joke).toLowerCase(), joke]));
  const seen = new Set<string>();
  const kept: ExtractedMoment[] = [];
  for (const moment of moments) {
    const text = normalized(moment.text);
    if (seen.has(text)) continue;
    seen.add(text);

    const label = moment.joke === null ? '' : normalized(moment.joke);
    kept.push({
      text,
      characters: [...new Set(moment.characters)].filter((nickname) => characters.has(nickname)),
      importance: moment.importance,
      joke: label === '' ? null : (jokes.get(label.toLowerCase()) ?? label),
    });
  }
  return kept;
}

/** What code does with one new moment. */
export type MomentDecision =
  | { readonly kind: 'add' }
  | { readonly kind: 'noop' }
  /** It replaces `target`, which stays with `superseded_by`. */
  | { readonly kind: 'update'; readonly target: number };

/** The decisions on a chapter's moments, in their order, with what kept them from being valid. */
export interface ComparisonValidation {
  readonly decisions: readonly MomentDecision[];
  /** Missing or repeated decisions: the answer gets one retry with these. */
  readonly issues: readonly string[];
  /** Updates turned into additions, because their target was not one of that moment's nearest. */
  readonly rejectedUpdates: number;
}

/**
 * Checks the narrator's decisions on new moments. An `UPDATE` stands only for one of that moment's
 * nearest, and only once per target; otherwise the moment is added, so nothing is lost.
 *
 * @param nearest - For each new moment, in order, the ids of the moments it was compared with.
 */
export function validateComparison(
  output: ComparisonOutput,
  nearest: readonly (readonly number[])[],
): ComparisonValidation {
  const issues: string[] = [];
  const byMoment = new Map<number, ComparisonOutput['decisions'][number]>();
  for (const decision of output.decisions) {
    if (decision.moment > nearest.length) {
      issues.push(`moment ${String(decision.moment)} does not exist`);
    } else if (byMoment.has(decision.moment)) {
      issues.push(`moment ${String(decision.moment)} has more than one decision`);
    } else {
      byMoment.set(decision.moment, decision);
    }
  }

  const replaced = new Set<number>();
  let rejectedUpdates = 0;
  const decisions = nearest.map((candidates, index): MomentDecision => {
    const decision = byMoment.get(index + 1);
    if (decision === undefined) {
      issues.push(`moment ${String(index + 1)} has no decision`);
      return { kind: 'add' };
    }
    if (decision.decision === 'NOOP') return { kind: 'noop' };
    if (decision.decision === 'ADD') return { kind: 'add' };

    const { target } = decision;
    if (target === null || !candidates.includes(target) || replaced.has(target)) {
      rejectedUpdates += 1;
      return { kind: 'add' };
    }
    replaced.add(target);
    return { kind: 'update', target };
  });

  // In the moments' order, so the retry reads them as they were numbered.
  issues.sort((first, second) => momentNumber(first) - momentNumber(second));
  return { decisions, issues, rejectedUpdates };
}

const momentNumber = (issue: string) => Number(/\d+/.exec(issue)?.[0] ?? 0);
