import type { LedgerEntry } from './chapter-ledger.ts';

/** A published day of the season, character by character. */
export interface LedgerDay {
  readonly day: string;
  readonly entries: readonly LedgerEntry[];
}

/** One day of a character's record, as the characters screen lists it. */
export interface RecordRow {
  readonly day: string;
  /** Its place in the season, from 1. */
  readonly dayNumber: number;
  readonly text: string;
  readonly meta: string;
  readonly change: number;
}

/** What the characters screen says about one character. */
export interface CharacterStats {
  readonly rank: number;
  /** How the balance moved on the latest published day, or null before any. */
  readonly lastChange: number | null;
  /** Days with a stake, and how many of them won points. */
  readonly stakes: { readonly won: number; readonly staked: number };
  /** The latest published days in a row with the player's own action. */
  readonly streak: number;
  /** The balance after each of the last five published days, oldest first. */
  readonly balances: readonly { readonly day: string; readonly balance: number }[];
  /** The last five days, newest first. */
  readonly record: readonly RecordRow[];
}

const DAY_MS = 86_400_000;
const HISTORY = 5;

/** A character's place, form and record over the season's published days. */
export function characterStats(input: {
  readonly characterId: number;
  readonly characters: readonly { readonly id: number; readonly balance: number }[];
  /** Published days, oldest first. */
  readonly ledger: readonly LedgerDay[];
  readonly startsOn: string;
}): CharacterStats {
  const { characterId, characters, ledger, startsOn } = input;
  const balance = characters.find(({ id }) => id === characterId)?.balance ?? 0;
  const days = ledger.map(({ day, entries }) => ({
    day,
    entry: entries.find((entry) => entry.characterId === characterId),
  }));

  const staked = days.filter(({ entry }) => entry?.kind === 'action' && (entry.stake ?? 0) > 0);
  let streak = 0;
  for (const { entry } of [...days].reverse()) {
    if (entry?.kind !== 'action' && entry?.kind !== 'struck_out') break;
    streak += 1;
  }

  // The current balance is the one after the latest day: walk back through each day's change.
  let after = balance;
  const balances = [...days]
    .reverse()
    .map(({ day, entry }) => {
      const row = { day, balance: after };
      after -= entry?.change ?? 0;
      return row;
    })
    .reverse()
    .slice(-HISTORY);

  const record = [...days]
    .reverse()
    .flatMap(({ day, entry }): RecordRow[] =>
      entry === undefined || entry.kind === 'none'
        ? []
        : [
            {
              day,
              dayNumber: Math.round((Date.parse(day) - Date.parse(startsOn)) / DAY_MS) + 1,
              text: recordText(entry),
              meta: recordMeta(entry),
              change: entry.change,
            },
          ],
    )
    .slice(0, HISTORY);

  return {
    rank: 1 + characters.filter((character) => character.balance > balance).length,
    lastChange: days.at(-1)?.entry?.change ?? null,
    stakes: {
      won: staked.filter(({ entry }) => (entry?.award ?? 0) > 0).length,
      staked: staked.length,
    },
    streak,
    balances,
    record,
  };
}

function recordText(entry: LedgerEntry): string {
  switch (entry.kind) {
    case 'autopilot':
      return 'No envió acción';
    case 'struck_out':
      return entry.text ?? 'Tachada por el censor';
    default:
      return entry.text ?? 'Acción sin texto';
  }
}

function recordMeta(entry: LedgerEntry): string {
  if (entry.kind === 'autopilot') return 'Piloto automático';
  if (entry.kind === 'struck_out') return 'Tachada por el censor';
  const charged = entry.charges.reduce((sum, { points }) => sum + points, 0);
  const stake = entry.stake ?? 0;
  if (stake === 0) return 'Sin envite';
  return charged > 0
    ? `Envite de ${String(stake)}, cobrado ${String(charged)}`
    : `Envite de ${String(stake)}`;
}

/** A place in Spanish, agreeing with the nickname's article: "1.ª" for La Farera, "2.º" otherwise. */
export function rankLabel(rank: number, nickname: string): string {
  return `${String(rank)}.${/^(la|las)\s/i.test(nickname) ? 'ª' : 'º'}`;
}
