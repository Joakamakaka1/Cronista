import type { ResolutionOutput } from './schemas/narrator-output.ts';

/** The lowest award the narrator can give an action. */
export const MIN_AWARD = -3;

/** The highest award the narrator can give an action. */
export const MAX_AWARD = 5;

/** What a player reads when the model refuses their hint. Players see this text. */
export const HINT_CENSOR_LINE = 'Tu pista ha sido tachada por el censor del periódico.';

/** A resolution that passed {@link validateResolution}, or everything wrong with it. */
export type ResolutionValidation =
  | { readonly ok: true; readonly value: ResolutionOutput }
  | { readonly ok: false; readonly error: { readonly issues: readonly string[] } };

/**
 * Checks a resolution against the day's real actions: one outcome each, for nobody else, with its
 * award in range. Model output never grants points without passing this.
 *
 * @param nicknames - The characters whose players sent an action, autopilot excluded.
 */
export function validateResolution(
  resolution: ResolutionOutput,
  nicknames: readonly string[],
): ResolutionValidation {
  const expected = new Set(nicknames);
  const seen = new Set<string>();
  const issues: string[] = [];

  for (const { nickname, award } of resolution.outcomes) {
    if (!expected.has(nickname)) issues.push(`outcome for unknown character ${nickname}`);
    else if (seen.has(nickname)) issues.push(`more than one outcome for ${nickname}`);
    if (award < MIN_AWARD || award > MAX_AWARD) {
      issues.push(`award ${String(award)} for ${nickname} is out of range`);
    }
    seen.add(nickname);
  }
  for (const nickname of nicknames) {
    if (!seen.has(nickname)) issues.push(`missing outcome for ${nickname}`);
  }

  return issues.length === 0 ? { ok: true, value: resolution } : { ok: false, error: { issues } };
}
