import { describe, expect, it } from 'vitest';

import { bibleSchema } from './bible.ts';

const bible = {
  world: 'Un pueblo costero inventado donde nada funciona.',
  tone: 'Crónica de sucesos, seca y burlona.',
  toneExamples: ['El alcalde volvió a perder la llave del ayuntamiento.'],
  redLines: ['La salud de nadie.'],
  characters: [
    { nickname: 'La Farera', sheet: 'Vigila un faro apagado.', redLines: [] },
    { nickname: 'El Notario', sheet: 'Certifica lo que le pagan.', redLines: ['Su familia.'] },
  ],
};

describe('bibleSchema', () => {
  it('accepts a complete bible', () => {
    expect(bibleSchema.parse(bible)).toEqual(bible);
  });

  it('rejects a bible with an empty section', () => {
    expect(bibleSchema.safeParse({ ...bible, world: '  ' }).success).toBe(false);
    expect(bibleSchema.safeParse({ ...bible, characters: [] }).success).toBe(false);
    expect(bibleSchema.safeParse({ ...bible, toneExamples: [] }).success).toBe(false);
  });

  it('rejects unknown fields, so a typo cannot silently drop a section', () => {
    expect(bibleSchema.safeParse({ ...bible, redlines: [] }).success).toBe(false);
  });

  it('rejects two characters with one nickname', () => {
    const [first] = bible.characters;
    expect(bibleSchema.safeParse({ ...bible, characters: [first, first] }).success).toBe(false);
  });
});
