import { describe, expect, it } from 'vitest';

import { chapterLedger, type ChapterRecords } from './chapter-ledger.ts';

const characters = [
  { id: 1, nickname: 'La Farera' },
  { id: 2, nickname: 'El Notario' },
  { id: 3, nickname: 'La Boticaria' },
];

const records = (overrides: Partial<ChapterRecords> = {}): ChapterRecords => ({
  characters,
  actions: [],
  newItems: [],
  movedItems: [],
  bornDebts: [],
  paidDebts: [],
  outCharacterIds: [],
  ...overrides,
});

describe('chapterLedger', () => {
  it("adds each character's award, charges and payments received into the day's change", () => {
    const ledger = chapterLedger(
      records({
        actions: [
          {
            characterId: 1,
            origin: 'player',
            struckOut: false,
            content: { text: 'Soborno al notario.', stake: 5 },
            award: { points: 1, kind: 'narrator' },
            charges: [
              { points: 2, purpose: 'payment', recipientCharacterId: 2 },
              { points: 1, purpose: 'influence', recipientCharacterId: null },
            ],
          },
          {
            characterId: 2,
            origin: 'player',
            struckOut: false,
            content: { text: 'Acepto.', stake: 0 },
            award: { points: 0, kind: 'narrator' },
            charges: [],
          },
        ],
      }),
    );

    expect(ledger.entries.map(({ nickname, change }) => [nickname, change])).toEqual([
      ['La Farera', -2],
      ['El Notario', 2],
      ['La Boticaria', 0],
    ]);
    expect(ledger.entries[0]?.charges).toEqual([
      { points: 2, purpose: 'payment', recipient: 'El Notario' },
      { points: 1, purpose: 'influence', recipient: null },
    ]);
  });

  it('marks autopilot, and a struck-out action with no text when its player is someone else', () => {
    const ledger = chapterLedger(
      records({
        actions: [
          {
            characterId: 1,
            origin: 'autopilot',
            struckOut: false,
            content: null,
            award: { points: -1, kind: 'autopilot' },
            charges: [],
          },
          {
            characterId: 2,
            origin: 'player',
            struckOut: true,
            content: null,
            award: { points: -2, kind: 'comic_penalty' },
            charges: [],
          },
        ],
      }),
    );

    expect(ledger.entries[0]).toMatchObject({ kind: 'autopilot', text: null, change: -1 });
    expect(ledger.entries[1]).toMatchObject({ kind: 'struck_out', text: null, change: -2 });
    expect(ledger.entries[2]).toMatchObject({ kind: 'none' });
  });

  it('keeps the text of your own struck-out action, which only you can read', () => {
    const ledger = chapterLedger(
      records({
        actions: [
          {
            characterId: 2,
            origin: 'player',
            struckOut: true,
            content: { text: 'Algo impublicable.', stake: 3 },
            award: { points: -2, kind: 'comic_penalty' },
            charges: [],
          },
        ],
      }),
    );

    expect(ledger.entries[1]).toMatchObject({
      kind: 'struck_out',
      text: 'Algo impublicable.',
      stake: 3,
    });
  });

  it('names the canon changes by nickname, the first owner of a stolen new item included', () => {
    const ledger = chapterLedger(
      records({
        newItems: [{ name: 'La llave', firstOwnerCharacterId: 1 }],
        movedItems: [{ name: 'El farol', fromCharacterId: 3, toCharacterId: 2 }],
        bornDebts: [{ debtorCharacterId: 2, creditorCharacterId: 1, points: 3 }],
        paidDebts: [{ debtorCharacterId: 3, creditorCharacterId: 1, points: 1 }],
        outCharacterIds: [3],
      }),
    );

    expect(ledger.changes).toEqual([
      { kind: 'new_item', item: 'La llave', owner: 'La Farera' },
      { kind: 'moved_item', item: 'El farol', from: 'La Boticaria', to: 'El Notario' },
      { kind: 'new_debt', debtor: 'El Notario', creditor: 'La Farera', points: 3 },
      { kind: 'paid_debt', debtor: 'La Boticaria', creditor: 'La Farera', points: 1 },
      { kind: 'out', character: 'La Boticaria' },
    ]);
  });
});
