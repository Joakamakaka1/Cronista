import { describe, expect, it } from 'vitest';

import {
  chapterOutputSchema,
  hintOutputSchema,
  resolutionOutputSchema,
  situationOutputSchema,
} from './narrator-output.ts';

describe('narrator output', () => {
  it('accepts a situation and a hint with text, trimmed', () => {
    expect(situationOutputSchema.parse({ text: ' Amanece. ' })).toEqual({ text: 'Amanece.' });
    expect(hintOutputSchema.parse({ text: 'Mira el faro.' })).toEqual({ text: 'Mira el faro.' });
  });

  it('rejects a hint far longer than the two sentences it should be', () => {
    expect(hintOutputSchema.safeParse({ text: 'x'.repeat(600) }).success).toBe(true);
    expect(hintOutputSchema.safeParse({ text: 'x'.repeat(601) }).success).toBe(false);
  });

  it('rejects blank text', () => {
    expect(situationOutputSchema.safeParse({ text: ' ' }).success).toBe(false);
    expect(hintOutputSchema.safeParse({ text: '' }).success).toBe(false);
    expect(chapterOutputSchema.safeParse({ title: 'Lunes', body: ' ' }).success).toBe(false);
    expect(chapterOutputSchema.safeParse({ title: ' ', body: 'Pasó.' }).success).toBe(false);
  });

  const outcome = {
    nickname: 'La Farera',
    summary: 'Enciende el faro.',
    award: 2,
    influence: 1,
    payments: [{ to: 'El Notario', points: 1 }],
    newItems: [{ name: 'La lámpara', price: 1 }],
    movedItems: [{ item: 'La llave', from: 'El Notario', to: 'La Farera' }],
    newDebts: [{ creditor: 'El Notario', points: 2 }],
    paidDebts: [{ creditor: 'La Boticaria' }],
    outCharacters: ['El Notario'],
  };

  it('accepts a resolution with its charges and canon changes', () => {
    const resolution = { outcomes: [outcome] };
    expect(resolutionOutputSchema.parse(resolution)).toEqual(resolution);
  });

  it('requires every field, because the API only sends what its schema requires', () => {
    const withoutPayments = Object.fromEntries(
      Object.entries(outcome).filter(([field]) => field !== 'payments'),
    );
    expect(resolutionOutputSchema.safeParse({ outcomes: [withoutPayments] }).success).toBe(false);
  });

  it.each([1.5, 6, -4])('rejects a resolution with an award of %d', (award) => {
    expect(resolutionOutputSchema.safeParse({ outcomes: [{ ...outcome, award }] }).success).toBe(
      false,
    );
  });

  it('leaves the ranges of charges and changes to the rules, which can drop one change', () => {
    const generous = {
      ...outcome,
      newItems: [{ name: 'La lámpara', price: 0 }],
      newDebts: [{ creditor: 'El Notario', points: 9 }],
    };
    expect(resolutionOutputSchema.safeParse({ outcomes: [generous] }).success).toBe(true);
  });

  it('rejects unknown fields in every output, so no output can carry extra decisions', () => {
    expect(situationOutputSchema.safeParse({ text: 'Amanece.', extra: 1 }).success).toBe(false);
    expect(hintOutputSchema.safeParse({ text: 'Mira.', extra: 1 }).success).toBe(false);
    expect(chapterOutputSchema.safeParse({ title: 'L', body: 'P', extra: 1 }).success).toBe(false);
    expect(
      resolutionOutputSchema.safeParse({ outcomes: [{ ...outcome, charge: 3 }] }).success,
    ).toBe(false);
  });
});
