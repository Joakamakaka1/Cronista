import { describe, expect, it } from 'vitest';

import { actionSchema } from './action.ts';

describe('actionSchema', () => {
  it('accepts an action of up to 1000 characters and trims it', () => {
    expect(actionSchema.parse({ text: '  Robo la llave del faro.  ' })).toEqual({
      text: 'Robo la llave del faro.',
    });
    expect(actionSchema.safeParse({ text: 'a'.repeat(1000) }).success).toBe(true);
  });

  it('rejects an action longer than 1000 characters', () => {
    expect(actionSchema.safeParse({ text: 'a'.repeat(1001) }).success).toBe(false);
  });

  it('counts the characters after trimming the spaces around them', () => {
    expect(actionSchema.safeParse({ text: ` ${'a'.repeat(1000)} ` }).success).toBe(true);
  });

  it('rejects an empty or blank action', () => {
    expect(actionSchema.safeParse({ text: '' }).success).toBe(false);
    expect(actionSchema.safeParse({ text: ' \n\t ' }).success).toBe(false);
  });

  it('rejects unknown fields, so the client cannot smuggle data in', () => {
    expect(actionSchema.safeParse({ text: 'Huyo.', playerId: 'x' }).success).toBe(false);
  });
});
