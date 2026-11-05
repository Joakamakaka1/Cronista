import { describe, expect, it } from 'vitest';

import { validateComparison, validateMoments } from './memory.ts';

const moment = (text: string, changes: object = {}) => ({
  text,
  characters: ['La Farera'],
  importance: 3,
  joke: null,
  ...changes,
});

describe('validateMoments', () => {
  const canon = ['La Farera', 'El Notario'];

  it('keeps only the characters canon knows, once each', () => {
    const [kept] = validateMoments(
      [moment('Uno.', { characters: ['La Farera', 'El Fantasma', 'La Farera', 'El Notario'] })],
      { characters: canon, jokes: [] },
    );
    expect(kept?.characters).toEqual(['La Farera', 'El Notario']);
  });

  it('reuses a known joke label whatever its case and spacing', () => {
    const [kept] = validateMoments([moment('Uno.', { joke: '  Las  VELAS del banco central ' })], {
      characters: canon,
      jokes: ['las velas del banco central'],
    });
    expect(kept?.joke).toBe('las velas del banco central');
  });

  it('trims a new joke label and leaves an empty one as none', () => {
    const kept = validateMoments(
      [moment('Uno.', { joke: '  el faro  apagado ' }), moment('Dos.', { joke: '   ' })],
      { characters: canon, jokes: [] },
    );
    expect(kept.map(({ joke }) => joke)).toEqual(['el faro apagado', null]);
  });

  it('drops a moment that repeats another word for word', () => {
    const kept = validateMoments([moment('Uno.'), moment(' Uno. ')], {
      characters: canon,
      jokes: [],
    });
    expect(kept).toHaveLength(1);
  });
});

describe('validateComparison', () => {
  const nearest = [[11, 12, 13], [21], []];

  it('answers each moment with what it does', () => {
    const { decisions, issues } = validateComparison(
      {
        decisions: [
          { moment: 1, decision: 'UPDATE', target: 12 },
          { moment: 2, decision: 'NOOP', target: null },
          { moment: 3, decision: 'ADD', target: null },
        ],
      },
      nearest,
    );
    expect(issues).toEqual([]);
    expect(decisions).toEqual([{ kind: 'update', target: 12 }, { kind: 'noop' }, { kind: 'add' }]);
  });

  it("accepts an update only for one of the moment's nearest, and adds it otherwise", () => {
    const { decisions, rejectedUpdates } = validateComparison(
      {
        decisions: [
          { moment: 1, decision: 'UPDATE', target: 21 },
          { moment: 2, decision: 'UPDATE', target: null },
          { moment: 3, decision: 'ADD', target: null },
        ],
      },
      nearest,
    );
    expect(decisions).toEqual([{ kind: 'add' }, { kind: 'add' }, { kind: 'add' }]);
    expect(rejectedUpdates).toBe(2);
  });

  it('lets one moment only supersede each earlier one', () => {
    const { decisions, rejectedUpdates } = validateComparison(
      {
        decisions: [
          { moment: 1, decision: 'UPDATE', target: 11 },
          { moment: 2, decision: 'ADD', target: null },
          { moment: 3, decision: 'ADD', target: null },
        ],
      },
      [[11], [11], []],
    );
    expect(decisions[0]).toEqual({ kind: 'update', target: 11 });
    expect(rejectedUpdates).toBe(0);

    const twice = validateComparison(
      {
        decisions: [
          { moment: 1, decision: 'UPDATE', target: 11 },
          { moment: 2, decision: 'UPDATE', target: 11 },
        ],
      },
      [[11], [11]],
    );
    expect(twice.decisions).toEqual([{ kind: 'update', target: 11 }, { kind: 'add' }]);
    expect(twice.rejectedUpdates).toBe(1);
  });

  it('reports a moment with no decision, or with two', () => {
    const { issues } = validateComparison(
      {
        decisions: [
          { moment: 1, decision: 'ADD', target: null },
          { moment: 1, decision: 'NOOP', target: null },
          { moment: 4, decision: 'ADD', target: null },
        ],
      },
      nearest,
    );
    expect(issues).toEqual([
      'moment 1 has more than one decision',
      'moment 2 has no decision',
      'moment 3 has no decision',
      'moment 4 does not exist',
    ]);
  });
});
