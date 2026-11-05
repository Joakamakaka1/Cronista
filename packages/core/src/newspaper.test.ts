import { describe, expect, it } from 'vitest';

import { censorParagraph } from './newspaper.ts';

describe('censorParagraph', () => {
  it('names one character', () => {
    expect(censorParagraph(['La Farera'])).toBe(
      'La acción de La Farera ha sido tachada por el censor del periódico.',
    );
  });

  it('names two characters', () => {
    expect(censorParagraph(['La Farera', 'El Notario'])).toBe(
      'Las acciones de La Farera y El Notario han sido tachadas por el censor del periódico.',
    );
  });

  it('names three characters', () => {
    expect(censorParagraph(['A', 'B', 'C'])).toBe(
      'Las acciones de A, B y C han sido tachadas por el censor del periódico.',
    );
  });
});
