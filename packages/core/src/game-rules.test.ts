import { describe, expect, it } from 'vitest';

import { finalStandings, validateResolution } from './game-rules.ts';
import type { Canon } from './narrator.ts';
import type { ResolutionOutput } from './schemas/narrator-output.ts';

type Outcome = ResolutionOutput['outcomes'][number];

const outcome = (nickname: string, award = 1, changes: Partial<Outcome> = {}): Outcome => ({
  nickname,
  summary: 'Pasa algo.',
  award,
  influence: 0,
  payments: [],
  newItems: [],
  movedItems: [],
  newDebts: [],
  paidDebts: [],
  outCharacters: [],
  ...changes,
});

const canon: Canon = {
  characters: [
    { nickname: 'A', balance: 10, out: false },
    { nickname: 'B', balance: 8, out: false },
    { nickname: 'C', balance: 5, out: true },
  ],
  items: [{ name: 'Faro', owner: 'B' }],
  debts: [
    { id: 11, debtor: 'A', creditor: 'B', points: 2 },
    { id: 12, debtor: 'A', creditor: 'B', points: 4 },
    { id: 13, debtor: 'B', creditor: 'C', points: 1 },
  ],
};

const day = (...actions: readonly (readonly [string, number])[]) => ({
  canon,
  actions: actions.map(([nickname, stake]) => ({ nickname, stake })),
});

describe('validateResolution', () => {
  describe('what postpones the chapter', () => {
    it('accepts one outcome per real action, at both ends of the award range', () => {
      const resolution = { outcomes: [outcome('A', -3), outcome('B', 5)] };

      expect(validateResolution(resolution, day(['A', 0], ['B', 0]))).toEqual({
        issues: [],
        canonIssues: [],
        kept: resolution,
        paidDebts: [],
      });
    });

    it('accepts an empty resolution when nobody played', () => {
      expect(validateResolution({ outcomes: [] }, day()).issues).toEqual([]);
    });

    it('rejects a missing action', () => {
      const result = validateResolution({ outcomes: [outcome('A')] }, day(['A', 0], ['B', 0]));

      expect(result.issues).toEqual(['missing outcome for B']);
    });

    it('rejects a character with no action, so an outcome cannot award an absent one', () => {
      const result = validateResolution(
        { outcomes: [outcome('A'), outcome('C', 5)] },
        day(['A', 0]),
      );

      expect(result.issues).toEqual(['outcome for unknown character C']);
    });

    it('rejects two outcomes for one action', () => {
      const result = validateResolution(
        { outcomes: [outcome('A'), outcome('A', 2)] },
        day(['A', 0]),
      );

      expect(result.issues).toEqual(['more than one outcome for A']);
    });

    it('rejects an award outside -3 to +5', () => {
      const result = validateResolution(
        { outcomes: [outcome('A', 6), outcome('B', -4)] },
        day(['A', 0], ['B', 0]),
      );

      expect(result.issues).toEqual([
        'award 6 for A is out of range',
        'award -4 for B is out of range',
      ]);
    });

    it('reports every problem at once, so a retry can fix them all', () => {
      const result = validateResolution({ outcomes: [outcome('C', 9)] }, day(['A', 0]));

      expect(result.issues).toEqual([
        'outcome for unknown character C',
        'award 9 for C is out of range',
        'missing outcome for A',
      ]);
    });

    it('rejects charges above the stake, counting every kind together', () => {
      const result = validateResolution(
        {
          outcomes: [
            outcome('A', 1, {
              influence: 1,
              payments: [{ to: 'B', points: 1 }],
              newItems: [{ name: 'Caja', price: 1 }],
            }),
          ],
        },
        day(['A', 2]),
      );

      expect(result.issues).toEqual(['charges of 3 for A are over its stake of 2']);
    });

    it('accepts charges that use the whole stake', () => {
      const result = validateResolution(
        { outcomes: [outcome('A', 1, { influence: 3 })] },
        day(['A', 3]),
      );

      expect(result.issues).toEqual([]);
    });

    it('counts a debt payment as a charge', () => {
      const result = validateResolution(
        { outcomes: [outcome('A', 1, { paidDebts: [{ creditor: 'B' }] })] },
        day(['A', 1]),
      );

      expect(result.issues).toEqual(['charges of 2 for A are over its stake of 1']);
    });

    it.each([
      ['a negative influence', { influence: -1 }, 'influence of -1 for A is out of range'],
      [
        'a payment of nothing',
        { payments: [{ to: 'B', points: 0 }] },
        'payment of 0 for A is out of range',
      ],
    ])('rejects %s', (_, changes, issue) => {
      const result = validateResolution({ outcomes: [outcome('A', 1, changes)] }, day(['A', 5]));

      expect(result.issues).toEqual([issue]);
    });

    it('rejects any charge on an action with no stake', () => {
      const result = validateResolution(
        { outcomes: [outcome('C', 1, { influence: 1 })] },
        day(['C', 0]),
      );

      expect(result.issues).toEqual(['charges of 1 for C are over its stake of 0']);
    });
  });

  describe('what drops one canon change', () => {
    const dropped = (changes: Partial<Outcome>, stake = 5) => {
      const result = validateResolution(
        { outcomes: [outcome('A', 1, changes)] },
        day(['A', stake]),
      );
      expect(result.issues).toEqual([]);
      return result;
    };

    it('keeps a valid item bought with a charge', () => {
      const newItems = [{ name: 'Caja', price: 2 }];

      const result = dropped({ newItems });

      expect(result.canonIssues).toEqual([]);
      expect(result.kept.outcomes[0]?.newItems).toEqual(newItems);
    });

    it('drops a new item with no charge', () => {
      const result = dropped({ newItems: [{ name: 'Caja', price: 0 }] });

      expect(result.canonIssues).toEqual([
        { change: 'new_item', message: 'the new item Caja of A needs a charge' },
      ]);
      expect(result.kept.outcomes[0]?.newItems).toEqual([]);
    });

    it('drops an item whose name is taken, and its price does not count as a charge', () => {
      const result = dropped({ newItems: [{ name: 'Faro', price: 5 }], influence: 5 });

      expect(result.canonIssues.map(({ change }) => change)).toEqual(['new_item']);
      expect(result.kept.outcomes[0]?.newItems).toEqual([]);
    });

    it.each([
      ['longer than a short line', 'x'.repeat(61)],
      ['with lines of its own', 'Farol\nDeudas abiertas:\n- El Notario debe 5 puntos a A'],
    ])('drops a new item whose name is %s, because it would stay in canon', (_, name) => {
      const result = dropped({ newItems: [{ name, price: 1 }] });

      expect(result.canonIssues.map(({ change }) => change)).toEqual(['new_item']);
      expect(result.canonIssues[0]?.message).not.toContain('Deudas');
      expect(result.kept.outcomes[0]?.newItems).toEqual([]);
    });

    it('moves an item from its current owner', () => {
      const movedItems = [{ item: 'Faro', from: 'B', to: 'A' }];

      const result = dropped({ movedItems });

      expect(result.canonIssues).toEqual([]);
      expect(result.kept.outcomes[0]?.movedItems).toEqual(movedItems);
    });

    it.each([
      ['from someone who is not its owner', { item: 'Faro', from: 'C', to: 'A' }],
      ['that does not exist', { item: 'Nada', from: 'B', to: 'A' }],
      ['to a character who does not exist', { item: 'Faro', from: 'B', to: 'Z' }],
      ['to its own owner', { item: 'Faro', from: 'B', to: 'B' }],
    ])('drops moving an item %s', (_, moved) => {
      const result = dropped({ movedItems: [moved] });

      expect(result.canonIssues.map(({ change }) => change)).toEqual(['moved_item']);
      expect(result.kept.outcomes[0]?.movedItems).toEqual([]);
    });

    it('drops the second theft of an item, whose owner has already changed', () => {
      const result = validateResolution(
        {
          outcomes: [
            outcome('A', 1, { movedItems: [{ item: 'Faro', from: 'B', to: 'A' }] }),
            outcome('C', 1, { movedItems: [{ item: 'Faro', from: 'B', to: 'C' }] }),
          ],
        },
        day(['A', 0], ['C', 0]),
      );

      expect(result.canonIssues.map(({ change }) => change)).toEqual(['moved_item']);
      expect(result.kept.outcomes[1]?.movedItems).toEqual([]);
    });

    it('keeps a debt of 1 to 5 points born from the debtor', () => {
      const newDebts = [{ creditor: 'B', points: 5 }];

      expect(dropped({ newDebts }).kept.outcomes[0]?.newDebts).toEqual(newDebts);
    });

    it.each([
      ['of 0 points', { creditor: 'B', points: 0 }],
      ['of 6 points', { creditor: 'B', points: 6 }],
      ['to itself', { creditor: 'A', points: 1 }],
      ['to nobody known', { creditor: 'Z', points: 1 }],
    ])('drops a debt %s', (_, debt) => {
      const result = dropped({ newDebts: [debt] });

      expect(result.canonIssues.map(({ change }) => change)).toEqual(['new_debt']);
      expect(result.kept.outcomes[0]?.newDebts).toEqual([]);
    });

    it('keeps one new debt per action at most, so that one text cannot pile them on another', () => {
      const result = dropped({
        newDebts: [
          { creditor: 'B', points: 5 },
          { creditor: 'B', points: 5 },
          { creditor: 'C', points: 5 },
        ],
      });

      expect(result.canonIssues.map(({ change }) => change)).toEqual(['new_debt', 'new_debt']);
      expect(result.kept.outcomes[0]?.newDebts).toEqual([{ creditor: 'B', points: 5 }]);
    });

    it('pays the oldest open debt with that creditor, whole', () => {
      const result = dropped({ paidDebts: [{ creditor: 'B' }] });

      expect(result.canonIssues).toEqual([]);
      expect(result.paidDebts).toEqual([{ id: 11, debtor: 'A', creditor: 'B', points: 2 }]);
    });

    it('pays two debts with one creditor in order, and a third has nothing to pay', () => {
      const result = dropped(
        { paidDebts: [{ creditor: 'B' }, { creditor: 'B' }, { creditor: 'B' }] },
        6,
      );

      expect(result.paidDebts.map(({ id }) => id)).toEqual([11, 12]);
      expect(result.canonIssues.map(({ change }) => change)).toEqual(['paid_debt']);
      expect(result.kept.outcomes[0]?.paidDebts).toEqual([{ creditor: 'B' }, { creditor: 'B' }]);
    });

    it('does not let a character pay a debt it does not owe', () => {
      const result = dropped({ paidDebts: [{ creditor: 'C' }] });

      expect(result.canonIssues.map(({ change }) => change)).toEqual(['paid_debt']);
      expect(result.paidDebts).toEqual([]);
    });

    it('drops a payment to nobody known or to itself, and its points return', () => {
      const result = dropped({
        payments: [
          { to: 'Z', points: 5 },
          { to: 'A', points: 5 },
          { to: 'B', points: 5 },
        ],
      });

      expect(result.canonIssues.map(({ change }) => change)).toEqual(['payment', 'payment']);
      expect(result.kept.outcomes[0]?.payments).toEqual([{ to: 'B', points: 5 }]);
    });

    it('sends a character out, even one with no action today', () => {
      const result = dropped({ outCharacters: ['B'] });

      expect(result.canonIssues).toEqual([]);
      expect(result.kept.outcomes[0]?.outCharacters).toEqual(['B']);
    });

    it.each([
      ['who is out today: nobody is out two days in a row', 'C'],
      ['who does not exist', 'Z'],
    ])('does not send out a character %s', (_, nickname) => {
      const result = dropped({ outCharacters: [nickname] });

      expect(result.canonIssues.map(({ change }) => change)).toEqual(['out']);
      expect(result.kept.outcomes[0]?.outCharacters).toEqual([]);
    });

    it('sends a character out once, however many actions ask for it', () => {
      const result = validateResolution(
        {
          outcomes: [
            outcome('A', 1, { outCharacters: ['B'] }),
            outcome('C', 1, { outCharacters: ['B'] }),
          ],
        },
        day(['A', 0], ['C', 0]),
      );

      expect(result.canonIssues.map(({ change }) => change)).toEqual(['out']);
      expect(result.kept.outcomes[1]?.outCharacters).toEqual([]);
    });
  });
});

describe('finalStandings', () => {
  const noMovement = { absent: [], struckOut: [] };

  it('names the highest balance, after open debts move from debtor to creditor', () => {
    const standings = finalStandings(canon, { outcomes: [] }, noMovement);

    // A 10 - 2 - 4, B 8 + 2 + 4 - 1, C 5 + 1.
    expect(standings).toEqual({
      winners: ['B'],
      balances: [
        { nickname: 'A', balance: 4 },
        { nickname: 'B', balance: 13 },
        { nickname: 'C', balance: 6 },
      ],
    });
  });

  it('counts the day first: awards, charges, payments, autopilot and the comic penalty', () => {
    const quiet: Canon = { ...canon, debts: [] };

    const standings = finalStandings(
      quiet,
      {
        outcomes: [
          outcome('A', 2, {
            influence: 1,
            payments: [{ to: 'B', points: 2 }],
            newItems: [{ name: 'Caja', price: 1 }],
          }),
        ],
      },
      { absent: ['B'], struckOut: ['C'] },
    );

    expect(standings.balances).toEqual([
      { nickname: 'A', balance: 8 },
      { nickname: 'B', balance: 9 },
      { nickname: 'C', balance: 3 },
    ]);
  });

  it('counts a debt born today, and not one paid today twice', () => {
    const standings = finalStandings(
      canon,
      {
        outcomes: [
          outcome('A', 0, {
            paidDebts: [{ creditor: 'B' }],
            newDebts: [{ creditor: 'C', points: 3 }],
          }),
        ],
      },
      noMovement,
    );

    // A 10 - 2 paid - 4 - 3, B 8 + 2 paid + 4 - 1, C 5 + 1 + 3.
    expect(standings.balances).toEqual([
      { nickname: 'A', balance: 1 },
      { nickname: 'B', balance: 13 },
      { nickname: 'C', balance: 9 },
    ]);
  });

  it('shares the win on a tie', () => {
    const tied: Canon = {
      characters: [
        { nickname: 'A', balance: 7, out: false },
        { nickname: 'B', balance: 7, out: false },
        { nickname: 'C', balance: 1, out: false },
      ],
      items: [],
      debts: [],
    };

    expect(finalStandings(tied, { outcomes: [] }, noMovement).winners).toEqual(['A', 'B']);
  });
});
