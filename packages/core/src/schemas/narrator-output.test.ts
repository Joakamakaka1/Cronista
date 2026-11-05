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

  it('rejects blank text', () => {
    expect(situationOutputSchema.safeParse({ text: ' ' }).success).toBe(false);
    expect(hintOutputSchema.safeParse({ text: '' }).success).toBe(false);
    expect(chapterOutputSchema.safeParse({ title: 'Lunes', body: ' ' }).success).toBe(false);
    expect(chapterOutputSchema.safeParse({ title: ' ', body: 'Pasó.' }).success).toBe(false);
  });

  it('accepts a resolution with one outcome per character', () => {
    const resolution = {
      outcomes: [{ nickname: 'La Farera', summary: 'Enciende el faro.', award: 2 }],
    };
    expect(resolutionOutputSchema.parse(resolution)).toEqual(resolution);
  });

  it.each([1.5, 6, -4])('rejects a resolution with an award of %d', (award) => {
    const outcome = { nickname: 'La Farera', summary: 'Enciende el faro.', award };
    expect(resolutionOutputSchema.safeParse({ outcomes: [outcome] }).success).toBe(false);
  });

  it('rejects unknown fields in every output, so no output can carry extra decisions', () => {
    expect(situationOutputSchema.safeParse({ text: 'Amanece.', extra: 1 }).success).toBe(false);
    expect(hintOutputSchema.safeParse({ text: 'Mira.', extra: 1 }).success).toBe(false);
    expect(chapterOutputSchema.safeParse({ title: 'L', body: 'P', extra: 1 }).success).toBe(false);
    const outcome = { nickname: 'X', summary: 'S', award: 0, charge: 3 };
    expect(resolutionOutputSchema.safeParse({ outcomes: [outcome] }).success).toBe(false);
  });
});
