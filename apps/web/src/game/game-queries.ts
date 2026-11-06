import { useQuery } from '@tanstack/react-query';

import { supabase } from '../supabase.ts';
import type { ChapterAction, ChapterRecords } from './chapter-ledger.ts';

/** The prefix of every game query, which live events invalidate. */
export const GAME_QUERY_KEY = 'game';

// -----------------------------------------------------------------------------
// The current season
// -----------------------------------------------------------------------------

/** A character as every player can see it. */
export interface Character {
  readonly id: number;
  readonly nickname: string;
  readonly balance: number;
  readonly playerId: number;
}

/** The season being played and what every screen needs to know about it. */
export interface CurrentSeason {
  readonly id: number;
  readonly number: number;
  readonly characters: readonly Character[];
  /** This player's character, or null if they have none this season. */
  readonly ownCharacterId: number | null;
  /** Characters out on the next day played: the ones the latest published chapter sent out. */
  readonly outCharacterIds: readonly number[];
  /** The latest published game day, if any. */
  readonly lastPublishedDay: string | null;
}

function unwrap<T>({ data, error }: { data: T; error: { code: string } | null }): T {
  if (error !== null) throw new Error(`Supabase query failed: ${error.code}`);
  return data;
}

function rows<T>({ data, error }: { data: T[] | null; error: { code: string } | null }): T[] {
  return unwrap({ data: data ?? [], error });
}

async function fetchCurrentSeason(): Promise<CurrentSeason | null> {
  // The season of the latest day, or the latest one created before its first day opens.
  const latestDay = unwrap(
    await supabase
      .from('game_days')
      .select('season_id')
      .order('day', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  const season = unwrap(
    latestDay === null
      ? await supabase
          .from('seasons')
          .select('id, number')
          .order('starts_on', { ascending: false })
          .limit(1)
          .maybeSingle()
      : await supabase.from('seasons').select('id, number').eq('id', latestDay.season_id).single(),
  );
  if (season === null) return null;

  const [characters, player, lastPublished] = await Promise.all([
    supabase
      .from('characters')
      .select('id, nickname, balance, player_id')
      .eq('season_id', season.id)
      .order('id'),
    supabase.from('players').select('id').maybeSingle(),
    supabase
      .from('game_days')
      .select('day, character_statuses(character_id, status)')
      .eq('season_id', season.id)
      .eq('state', 'published')
      .order('day', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const ownPlayerId = unwrap(player)?.id;
  const seasonCharacters = rows(characters).map((character) => ({
    id: character.id,
    nickname: character.nickname,
    balance: character.balance,
    playerId: character.player_id,
  }));
  const published = unwrap(lastPublished);

  return {
    id: season.id,
    number: season.number,
    characters: seasonCharacters,
    ownCharacterId: seasonCharacters.find(({ playerId }) => playerId === ownPlayerId)?.id ?? null,
    outCharacterIds: (published?.character_statuses ?? [])
      .filter(({ status }) => status === 'out')
      .map(({ character_id }) => character_id),
    lastPublishedDay: published?.day ?? null,
  };
}

/** The season being played, its characters and this player's own. */
export function useCurrentSeason() {
  return useQuery({ queryKey: [GAME_QUERY_KEY, 'season'], queryFn: fetchCurrentSeason });
}

// -----------------------------------------------------------------------------
// Today
// -----------------------------------------------------------------------------

/** The latest game day of a season, as the today screen shows it. */
export interface Today {
  readonly id: number;
  readonly day: string;
  readonly state: 'open' | 'postponed' | 'published';
  readonly situation: string;
  readonly newspaperMessage: string | null;
  /** Characters whose player has sent an action, never what it says. */
  readonly playedCharacterIds: readonly number[];
  /** This player's own action, which only they can read before the chapter. */
  readonly ownAction: { readonly text: string; readonly stake: number } | null;
  readonly hint: { readonly text: string; readonly censored: boolean } | null;
}

async function fetchToday(seasonId: number, ownCharacterId: number | null): Promise<Today | null> {
  const day = unwrap(
    await supabase
      .from('game_days')
      .select('id, day, state, situation, newspaper_message')
      .eq('season_id', seasonId)
      .order('day', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  if (day === null) return null;

  const [actions, hint] = await Promise.all([
    supabase
      .from('actions')
      .select('character_id, origin, action_contents(text, stake)')
      .eq('game_day_id', day.id),
    supabase.from('hints').select('text, censored').eq('game_day_id', day.id).maybeSingle(),
  ]);
  const dayActions = rows(actions);
  const own = dayActions.find(
    ({ character_id, origin }) => character_id === ownCharacterId && origin === 'player',
  );

  return {
    id: day.id,
    day: day.day,
    state: day.state,
    situation: day.situation,
    newspaperMessage: day.newspaper_message,
    playedCharacterIds: dayActions
      .filter(({ origin }) => origin === 'player')
      .map(({ character_id }) => character_id),
    ownAction: own?.action_contents ?? null,
    hint: unwrap(hint),
  };
}

/** The latest day of the season, who has played it and this player's action and hint. */
export function useToday(season: CurrentSeason | null | undefined) {
  return useQuery({
    queryKey: [GAME_QUERY_KEY, 'today', season?.id, season?.ownCharacterId],
    queryFn: () => fetchToday(season?.id ?? 0, season?.ownCharacterId ?? null),
    enabled: season !== null && season !== undefined,
  });
}

// -----------------------------------------------------------------------------
// A chapter
// -----------------------------------------------------------------------------

/** A published chapter, with what every character did and what changed. */
export interface Chapter {
  readonly day: string;
  readonly seasonNumber: number;
  readonly title: string;
  readonly body: string;
  readonly records: ChapterRecords;
}

async function fetchChapter(dayDate: string): Promise<Chapter | null> {
  // A shared link can be mangled: anything that is not a date names no chapter.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate) || Number.isNaN(Date.parse(dayDate))) return null;
  // Seasons never overlap, so a date names one day; the newest season wins if they ever did.
  const day = unwrap(
    await supabase
      .from('game_days')
      .select('id, day, season_id, seasons(number), chapters(title, body)')
      .eq('day', dayDate)
      .eq('state', 'published')
      .order('season_id', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  if (day?.chapters === null || day === null) return null;

  const [characters, actions, newItems, moves, bornDebts, paidDebts, statuses] = await Promise.all([
    supabase.from('characters').select('id, nickname').eq('season_id', day.season_id).order('id'),
    supabase
      .from('actions')
      .select(
        'character_id, origin, struck_out, action_contents(text, stake), awards(points, kind), charges(points, purpose, recipient_character_id)',
      )
      .eq('game_day_id', day.id),
    supabase
      .from('items')
      .select('id, name, owner_character_id, item_moves(from_character_id, id)')
      .eq('acquired_on_day_id', day.id),
    supabase
      .from('item_moves')
      .select('from_character_id, to_character_id, items(name)')
      .eq('game_day_id', day.id)
      .order('id'),
    supabase
      .from('debts')
      .select('debtor_character_id, creditor_character_id, points')
      .eq('born_on_day_id', day.id),
    supabase
      .from('debts')
      .select('debtor_character_id, creditor_character_id, points')
      .eq('paid_on_day_id', day.id),
    supabase
      .from('character_statuses')
      .select('character_id')
      .eq('game_day_id', day.id)
      .eq('status', 'out'),
  ]);

  const debt = (row: {
    debtor_character_id: number;
    creditor_character_id: number;
    points: number;
  }) => ({
    debtorCharacterId: row.debtor_character_id,
    creditorCharacterId: row.creditor_character_id,
    points: row.points,
  });

  return {
    day: day.day,
    seasonNumber: day.seasons.number,
    title: day.chapters.title,
    body: day.chapters.body,
    records: {
      characters: rows(characters),
      actions: rows(actions).map((action): ChapterAction => ({
        characterId: action.character_id,
        origin: action.origin,
        struckOut: action.struck_out,
        content: action.action_contents,
        award: action.awards,
        charges: action.charges.map((charge) => ({
          points: charge.points,
          purpose: charge.purpose,
          recipientCharacterId: charge.recipient_character_id,
        })),
      })),
      // A new item stolen later has moved on: its first owner is where its first move started.
      newItems: rows(newItems).map((item) => ({
        name: item.name,
        firstOwnerCharacterId:
          [...item.item_moves].sort((first, second) => first.id - second.id)[0]
            ?.from_character_id ?? item.owner_character_id,
      })),
      movedItems: rows(moves).map((move) => ({
        name: move.items.name,
        fromCharacterId: move.from_character_id,
        toCharacterId: move.to_character_id,
      })),
      bornDebts: rows(bornDebts).map(debt),
      paidDebts: rows(paidDebts).map(debt),
      outCharacterIds: rows(statuses).map(({ character_id }) => character_id),
    },
  };
}

/** The published chapter of `day` (`YYYY-MM-DD`), or null if there is none. */
export function useChapter(day: string) {
  return useQuery({ queryKey: [GAME_QUERY_KEY, 'chapter', day], queryFn: () => fetchChapter(day) });
}

// -----------------------------------------------------------------------------
// The archive
// -----------------------------------------------------------------------------

/** A published chapter in the archive. */
export interface ArchiveEntry {
  readonly day: string;
  readonly seasonNumber: number;
  readonly title: string;
}

async function fetchArchive(): Promise<readonly ArchiveEntry[]> {
  const days = rows(
    await supabase
      .from('game_days')
      .select('day, seasons(number), chapters(title)')
      .eq('state', 'published')
      .order('day', { ascending: false }),
  );
  return days.flatMap(({ day, seasons, chapters }) =>
    chapters === null ? [] : [{ day, seasonNumber: seasons.number, title: chapters.title }],
  );
}

/** Every published chapter, newest first. */
export function useArchive() {
  return useQuery({ queryKey: [GAME_QUERY_KEY, 'archive'], queryFn: fetchArchive });
}

// -----------------------------------------------------------------------------
// Canon
// -----------------------------------------------------------------------------

/** The season's items and open debts, by character id. */
export interface Canon {
  readonly items: readonly { readonly name: string; readonly ownerCharacterId: number }[];
  readonly openDebts: readonly {
    readonly debtorCharacterId: number;
    readonly creditorCharacterId: number;
    readonly points: number;
  }[];
}

async function fetchCanon(season: CurrentSeason): Promise<Canon> {
  const characterIds = season.characters.map(({ id }) => id);
  const [items, debts] = await Promise.all([
    supabase
      .from('items')
      .select('name, owner_character_id')
      .eq('season_id', season.id)
      .order('id'),
    supabase
      .from('debts')
      .select('debtor_character_id, creditor_character_id, points')
      .in('debtor_character_id', characterIds)
      .is('paid_on_day_id', null)
      .order('id'),
  ]);
  return {
    items: rows(items).map(({ name, owner_character_id }) => ({
      name,
      ownerCharacterId: owner_character_id,
    })),
    openDebts: rows(debts).map((debt) => ({
      debtorCharacterId: debt.debtor_character_id,
      creditorCharacterId: debt.creditor_character_id,
      points: debt.points,
    })),
  };
}

/** The current season's items and open debts. */
export function useCanon(season: CurrentSeason | null | undefined) {
  return useQuery({
    queryKey: [GAME_QUERY_KEY, 'canon', season?.id],
    queryFn: () => (season ? fetchCanon(season) : Promise.resolve({ items: [], openDebts: [] })),
    enabled: season !== null && season !== undefined,
  });
}
