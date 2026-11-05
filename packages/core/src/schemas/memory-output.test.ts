import { describe, expect, it } from 'vitest';

import { comparisonOutputSchema, momentsOutputSchema } from './memory-output.ts';

const moment = (text: string) => ({
  text,
  characters: ['La Farera'],
  importance: 3,
  joke: null,
});

const moments = (count: number) =>
  Array.from({ length: count }, (_, index) => moment(`Pasó ${String(index)}.`));

describe('momentsOutputSchema', () => {
  it('accepts a summary and from 5 to 20 moments', () => {
    expect(
      momentsOutputSchema.safeParse({ summary: 'Resumen.', moments: moments(5) }).success,
    ).toBe(true);
    expect(
      momentsOutputSchema.safeParse({ summary: 'Resumen.', moments: moments(20) }).success,
    ).toBe(true);
    expect(
      momentsOutputSchema.safeParse({ summary: 'Resumen.', moments: moments(4) }).success,
    ).toBe(false);
    expect(
      momentsOutputSchema.safeParse({ summary: 'Resumen.', moments: moments(21) }).success,
    ).toBe(false);
  });

  it('holds importance from 1 to 5 and a moment to 500 characters', () => {
    const with_ = (changes: object) => ({
      summary: 'Resumen.',
      moments: [...moments(4), { ...moment('Uno.'), ...changes }],
    });
    expect(momentsOutputSchema.safeParse(with_({ importance: 0 })).success).toBe(false);
    expect(momentsOutputSchema.safeParse(with_({ importance: 6 })).success).toBe(false);
    expect(momentsOutputSchema.safeParse(with_({ importance: 2.5 })).success).toBe(false);
    expect(momentsOutputSchema.safeParse(with_({ text: 'x'.repeat(500) })).success).toBe(true);
    expect(momentsOutputSchema.safeParse(with_({ text: 'x'.repeat(501) })).success).toBe(false);
  });

  it('takes a joke label of one line and at most 60 characters', () => {
    const withJoke = (joke: string | null) => ({
      summary: 'Resumen.',
      moments: [...moments(4), { ...moment('Uno.'), joke }],
    });
    expect(momentsOutputSchema.safeParse(withJoke('las velas del banco central')).success).toBe(
      true,
    );
    expect(momentsOutputSchema.safeParse(withJoke(null)).success).toBe(true);
    expect(momentsOutputSchema.safeParse(withJoke('dos\nlíneas')).success).toBe(false);
    expect(momentsOutputSchema.safeParse(withJoke('x'.repeat(61))).success).toBe(false);
  });

  it('holds the summary to a short paragraph', () => {
    expect(
      momentsOutputSchema.safeParse({ summary: 'x'.repeat(601), moments: moments(5) }).success,
    ).toBe(false);
    expect(momentsOutputSchema.safeParse({ summary: ' ', moments: moments(5) }).success).toBe(
      false,
    );
  });
});

describe('comparisonOutputSchema', () => {
  it('accepts one flat decision per moment', () => {
    expect(
      comparisonOutputSchema.safeParse({
        decisions: [
          { moment: 1, decision: 'ADD', target: null },
          { moment: 2, decision: 'UPDATE', target: 14 },
          { moment: 3, decision: 'NOOP', target: null },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects any other decision', () => {
    expect(
      comparisonOutputSchema.safeParse({
        decisions: [{ moment: 1, decision: 'DELETE', target: 3 }],
      }).success,
    ).toBe(false);
  });
});
