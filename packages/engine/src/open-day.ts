import { type Narrator, RESERVE_SITUATION, type Result } from '@cronista/core';

import { activeSeason } from './active-season.ts';
import { dayNotOpenedAlert, noFinaleAlert, reserveSituationAlert } from './alerts.ts';
import {
  CHAPTERS_FOR_CONTINUITY,
  closeDay,
  type CloseDayDependencies,
  type CloseDayResult,
  isOutage,
} from './close-day.ts';
import { retryingCall } from './retrying-call.ts';
import type { StoreFailure } from './store.ts';

/** Why a day did not open. Any of these keeps the job from reporting completion. */
export type OpenDayFailure =
  | StoreFailure
  /** A chapter is still pending after trying it again, for what the model answered. */
  | 'previous_day_unresolved'
  /** A chapter is still pending after trying it again, for an outage a retry can fix. */
  | 'previous_day_unavailable'
  | 'bible_unavailable'
  /** The bible's nicknames are not the season's characters. */
  | 'bible_mismatch'
  /** The model could not be reached, which a retry can fix. */
  | 'situation_unavailable';

/** What running the opening achieved. */
export type OpenDayResult = Result<'no_active_season' | 'opened' | 'already_open', OpenDayFailure>;

/** What {@link openDay} needs: all that closing a pending day does too. */
export interface OpenDayDependencies extends CloseDayDependencies {
  readonly narrator: Pick<Narrator, 'situation' | 'resolve' | 'narrate' | 'testAction'>;
}

/**
 * Opens game day `day` with its situation, after trying again a chapter still pending: canon never
 * advances over an unresolved day. If the narrator cannot write the situation, the newspaper's fixed
 * text opens the day. Running it twice opens it once, and with no active season it does nothing and
 * spends nothing.
 */
export async function openDay(
  dependencies: OpenDayDependencies,
  day: string,
): Promise<OpenDayResult> {
  const { store, narrator, loadBible, alert } = dependencies;

  // The latest season, ended or not: a postponed finale is pending the morning after its last day.
  const started = await store.latestStartedSeason(day);
  if (!started.ok) return started;
  if (started.value !== undefined) {
    const pending = await store.unresolvedDayBefore(started.value.id, day);
    if (!pending.ok) return pending;
    if (pending.value !== undefined) {
      const failure = await retryPendingClose(dependencies, day, pending.value);
      if (failure !== undefined) return { ok: false, error: failure };
      // No day opens over a pending one, so a season's last day cannot have opened after this one.
      const { endsOn } = started.value;
      if (endsOn !== null && endsOn < day && pending.value < endsOn) {
        await alert(noFinaleAlert(endsOn, pending.value));
      }
    }
  }

  const season = await activeSeason(store, day);
  if (!season.ok) return season;
  if (season.value === undefined) return { ok: true, value: 'no_active_season' };

  const existing = await store.gameDay(season.value.id, day);
  if (!existing.ok) return existing;
  if (existing.value !== undefined) return { ok: true, value: 'already_open' };

  const bible = await loadBible(season.value.number);
  if (!bible.ok) return bible;

  const canon = await store.canon(season.value.id, day);
  if (!canon.ok) return canon;
  const inBible = new Set(bible.value.characters.map(({ nickname }) => nickname));
  const matches =
    inBible.size === canon.value.characters.length &&
    canon.value.characters.every(({ nickname }) => inBible.has(nickname));
  if (!matches) return { ok: false, error: 'bible_mismatch' };

  const lastChapters = await store.lastChapters(season.value.id, day, CHAPTERS_FOR_CONTINUITY);
  if (!lastChapters.ok) return lastChapters;

  const input = {
    bible: bible.value,
    day,
    canon: canon.value,
    lastChapters: lastChapters.value,
  };
  const situation = await retryingCall({
    call: (retry) => narrator.situation({ ...input, retry }),
    record: (result) => store.recordUsage(result.usage, day),
    softerOnRefusal: true,
  });
  if (situation.kind === 'technical') {
    console.warn({ message: 'situation failed', day, failure: situation.kind });
    return { ok: false, error: 'situation_unavailable' };
  }

  const reserve = situation.kind !== 'answered';
  const text = situation.kind === 'answered' ? situation.value.text : RESERVE_SITUATION;
  const opened = await store.openGameDay(season.value.id, day, text);
  if (!opened.ok) return opened;
  if (reserve && opened.value.opened) {
    console.warn({ message: 'reserve situation used', day, failure: situation.kind });
    await alert(reserveSituationAlert(day, situation.kind));
  }
  return { ok: true, value: opened.value.opened ? 'opened' : 'already_open' };
}

/** Runs a pending close again. It answers why the day cannot open, or nothing if it now can. */
async function retryPendingClose(
  dependencies: OpenDayDependencies,
  day: string,
  pendingDay: string,
): Promise<OpenDayFailure | undefined> {
  const closed: CloseDayResult = await closeDay(dependencies, pendingDay);
  if (!closed.ok) {
    if (closed.error === 'store_unavailable') return closed.error;
    await dependencies.alert(dayNotOpenedAlert(day, pendingDay, closed.error));
    return 'previous_day_unresolved';
  }
  if (closed.value.status !== 'postponed') return undefined;

  const { reason } = closed.value;
  // Lambda retries the job, and its errors alarm tells the owner, so an email here would repeat it.
  if (isOutage(reason)) return 'previous_day_unavailable';
  await dependencies.alert(dayNotOpenedAlert(day, pendingDay, reason));
  return 'previous_day_unresolved';
}
