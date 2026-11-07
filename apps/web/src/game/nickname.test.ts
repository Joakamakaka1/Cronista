import { describe, expect, it } from 'vitest';

import { inSentence, isFeminine, patternWord, shortName } from './nickname.ts';

describe('nicknames in the design', () => {
  it('drops the article for the short name under a mascot', () => {
    expect(shortName('El Notario')).toBe('Notario');
    expect(shortName('La Farera')).toBe('Farera');
    expect(shortName('Mortadelo')).toBe('Mortadelo');
  });

  it('lowers the article inside a sentence', () => {
    expect(inSentence('La Boticaria')).toBe('la Boticaria');
    expect(inSentence('El Sereno')).toBe('el Sereno');
    expect(inSentence('Mortadelo')).toBe('Mortadelo');
  });

  it('reads the gender from the article, masculine by default', () => {
    expect(isFeminine('La Boticaria')).toBe(true);
    expect(isFeminine('El Sereno')).toBe(false);
    expect(isFeminine('Mortadelo')).toBe(false);
  });

  it('makes the word repeated behind a character card, seven letters at most', () => {
    expect(patternWord('La Farera')).toBe('FARERA');
    expect(patternWord('El Contrabandista')).toBe('CONTRAB');
  });
});
