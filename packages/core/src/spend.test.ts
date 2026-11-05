import { describe, expect, it } from 'vitest';

import { creditCycleStart, spendAlertsDue } from './spend.ts';

describe('creditCycleStart', () => {
  it.each([
    ['2026-11-19T00:00:00Z', '2026-11-19'],
    ['2026-11-30T12:00:00Z', '2026-11-19'],
    ['2026-11-18T23:59:59Z', '2026-10-19'],
    ['2026-12-05T08:00:00Z', '2026-11-19'],
    ['2027-01-02T08:00:00Z', '2026-12-19'],
  ])('at %s the cycle started on %s', (now, start) => {
    expect(creditCycleStart(new Date(now))).toBe(start);
  });
});

describe('spendAlertsDue', () => {
  it('stays quiet below 50 % of the budget', () => {
    expect(spendAlertsDue({ 'game-prod': 7.49 }, [])).toEqual([]);
  });

  it('asks for 50 % when spend reaches half of a budget of 15 $', () => {
    expect(spendAlertsDue({ 'game-prod': 7.5 }, [])).toEqual([
      { workspace: 'game-prod', threshold: 50, spentUsd: 7.5, budgetUsd: 15 },
    ]);
  });

  it('asks for both thresholds when spend jumps past them together', () => {
    expect(
      spendAlertsDue({ dev: 4.5 }, []).map(({ workspace, threshold }) => [workspace, threshold]),
    ).toEqual([
      ['dev', 50],
      ['dev', 80],
    ]);
  });

  it('never repeats a threshold already sent in the cycle', () => {
    const due = spendAlertsDue({ evals: 30 }, [{ workspace: 'evals', threshold: 50 }]);

    expect(due.map(({ threshold }) => threshold)).toEqual([80]);
  });

  it('looks at each workspace against its own budget', () => {
    const due = spendAlertsDue({ evals: 5, dev: 5 }, []);

    expect(due.map(({ workspace }) => workspace)).toEqual(['dev', 'dev']);
  });

  it('ignores a workspace it has no budget for', () => {
    expect(spendAlertsDue({ other: 1000 }, [])).toEqual([]);
  });
});
