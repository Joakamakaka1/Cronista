import type { GameStore, StoredSeason, StoreResult } from './store.ts';

/**
 * The season being played on `day`: the latest one started, unless it has ended. Checking the end
 * after choosing the latest is what stops the open-ended pre-season coming back after season 1.
 */
export async function activeSeason(
  store: Pick<GameStore, 'latestStartedSeason'>,
  day: string,
): Promise<StoreResult<StoredSeason | undefined>> {
  const season = await store.latestStartedSeason(day);
  if (!season.ok) return season;
  const ended =
    season.value?.endsOn !== null &&
    season.value?.endsOn !== undefined &&
    season.value.endsOn < day;
  return { ok: true, value: ended ? undefined : season.value };
}
