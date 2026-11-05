/**
 * Why a hint was not given. `hint_unavailable` is a technical failure: it spends no quota, so the
 * player can ask again.
 */
export type HintRejection =
  'no_character' | 'no_action' | 'day_not_open' | 'day_closed' | 'hint_unavailable';

/** What a player reads as their hint. `censored` marks the fixed censor line. */
export interface Hint {
  readonly text: string;
  readonly censored: boolean;
}
