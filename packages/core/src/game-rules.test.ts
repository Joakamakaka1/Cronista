import { describe, expect, it } from 'vitest';

import { validateResolution } from './game-rules.ts';

const outcome = (nickname: string, award: number) => ({
  nickname,
  summary: 'Pasa algo.',
  award,
});

describe('validateResolution', () => {
  it('accepts one outcome per real action, at both ends of the award range', () => {
    const resolution = { outcomes: [outcome('A', -3), outcome('B', 5)] };

    expect(validateResolution(resolution, ['A', 'B'])).toEqual({ ok: true, value: resolution });
  });

  it('accepts an empty resolution when nobody played', () => {
    expect(validateResolution({ outcomes: [] }, [])).toEqual({ ok: true, value: { outcomes: [] } });
  });

  it('rejects a missing action', () => {
    const result = validateResolution({ outcomes: [outcome('A', 1)] }, ['A', 'B']);

    expect(result).toEqual({ ok: false, error: { issues: ['missing outcome for B'] } });
  });

  it('rejects a character with no action, so an outcome cannot award an absent character', () => {
    const result = validateResolution({ outcomes: [outcome('A', 1), outcome('C', 5)] }, ['A']);

    expect(result).toEqual({ ok: false, error: { issues: ['outcome for unknown character C'] } });
  });

  it('rejects two outcomes for one action', () => {
    const result = validateResolution({ outcomes: [outcome('A', 1), outcome('A', 2)] }, ['A']);

    expect(result).toEqual({ ok: false, error: { issues: ['more than one outcome for A'] } });
  });

  it('rejects an award outside -3 to +5', () => {
    const result = validateResolution({ outcomes: [outcome('A', 6), outcome('B', -4)] }, [
      'A',
      'B',
    ]);

    expect(result).toEqual({
      ok: false,
      error: { issues: ['award 6 for A is out of range', 'award -4 for B is out of range'] },
    });
  });

  it('reports every problem at once, so a retry can fix them all', () => {
    const result = validateResolution({ outcomes: [outcome('C', 9)] }, ['A']);

    expect(result).toEqual({
      ok: false,
      error: {
        issues: [
          'outcome for unknown character C',
          'award 9 for C is out of range',
          'missing outcome for A',
        ],
      },
    });
  });
});
