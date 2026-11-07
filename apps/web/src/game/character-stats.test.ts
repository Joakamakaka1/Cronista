import { describe, expect, it } from 'vitest';

import type { LedgerEntry } from './chapter-ledger.ts';
import { characterStats, rankLabel } from './character-stats.ts';

const entry = (characterId: number, overrides: Partial<LedgerEntry>): LedgerEntry => ({
  characterId,
  nickname: `P${String(characterId)}`,
  kind: 'action',
  text: 'Algo.',
  stake: 0,
  award: 0,
  charges: [],
  change: 0,
  ...overrides,
});

// Character 1 over four published days of a season that started on 2026-11-09.
const ledger = [
  {
    day: '2026-11-09',
    entries: [entry(1, { stake: 1, award: 2, change: 2, text: 'Compra un barco.' })],
  },
  {
    day: '2026-11-10',
    entries: [entry(1, { kind: 'autopilot', text: null, stake: null, award: -1, change: -1 })],
  },
  {
    day: '2026-11-11',
    entries: [
      entry(1, {
        stake: 2,
        award: -1,
        charges: [{ points: 1, purpose: 'influence', recipient: null }],
        change: -2,
        text: 'Amenaza al tabernero.',
      }),
    ],
  },
  {
    day: '2026-11-12',
    entries: [entry(1, { stake: 2, award: 3, change: 3, text: 'Revienta la puerta del faro.' })],
  },
];

const characters = [
  { id: 1, balance: 12 },
  { id: 2, balance: 15 },
  { id: 3, balance: 12 },
];

const stats = characterStats({ characterId: 1, characters, ledger, startsOn: '2026-11-09' });

describe('characterStats', () => {
  it('ranks by balance, and ties share a place', () => {
    expect(stats.rank).toBe(2);
    expect(
      characterStats({ characterId: 3, characters, ledger, startsOn: '2026-11-09' }).rank,
    ).toBe(2);
    expect(
      characterStats({ characterId: 2, characters, ledger, startsOn: '2026-11-09' }).rank,
    ).toBe(1);
  });

  it('takes the change of the latest published day', () => {
    expect(stats.lastChange).toBe(3);
  });

  it('counts the staked days that won points', () => {
    expect(stats.stakes).toEqual({ won: 2, staked: 3 });
  });

  it('counts the latest days in a row the player played themselves', () => {
    expect(stats.streak).toBe(2);
  });

  it('works back the balance after each of the last five days from the current one', () => {
    expect(stats.balances).toEqual([
      { day: '2026-11-09', balance: 12 },
      { day: '2026-11-10', balance: 11 },
      { day: '2026-11-11', balance: 9 },
      { day: '2026-11-12', balance: 12 },
    ]);
  });

  it('lists the record newest first, with what each day cost', () => {
    expect(stats.record).toEqual([
      {
        day: '2026-11-12',
        dayNumber: 4,
        text: 'Revienta la puerta del faro.',
        meta: 'Envite de 2',
        change: 3,
      },
      {
        day: '2026-11-11',
        dayNumber: 3,
        text: 'Amenaza al tabernero.',
        meta: 'Envite de 2, cobrado 1',
        change: -2,
      },
      {
        day: '2026-11-10',
        dayNumber: 2,
        text: 'No envió acción',
        meta: 'Piloto automático',
        change: -1,
      },
      { day: '2026-11-09', dayNumber: 1, text: 'Compra un barco.', meta: 'Envite de 1', change: 2 },
    ]);
  });

  it('has nothing to say before any chapter', () => {
    const empty = characterStats({
      characterId: 1,
      characters,
      ledger: [],
      startsOn: '2026-11-09',
    });
    expect(empty).toMatchObject({ lastChange: null, stakes: { won: 0, staked: 0 }, streak: 0 });
    expect(empty.balances).toEqual([]);
    expect(empty.record).toEqual([]);
  });
});

describe('rankLabel', () => {
  it('agrees with the nickname’s article', () => {
    expect(rankLabel(1, 'La Farera')).toBe('1.ª');
    expect(rankLabel(2, 'El Contrabandista')).toBe('2.º');
    expect(rankLabel(3, 'Mortadelo')).toBe('3.º');
  });
});
