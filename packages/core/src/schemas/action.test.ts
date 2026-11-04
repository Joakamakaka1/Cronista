import { describe, expect, it } from 'vitest';

import { actionSchema } from './action.ts';

describe('actionSchema', () => {
  it('accepts an action of up to 1000 characters and trims it', () => {
    expect(actionSchema.parse({ text: '  Robo la llave del faro.  ', stake: 2 })).toEqual({
      text: 'Robo la llave del faro.',
      stake: 2,
    });
    expect(actionSchema.safeParse({ text: 'a'.repeat(1000), stake: 0 }).success).toBe(true);
  });

  it('rejects an action longer than 1000 characters', () => {
    expect(actionSchema.safeParse({ text: 'a'.repeat(1001), stake: 0 }).success).toBe(false);
  });

  it('counts the characters after trimming the spaces around them', () => {
    expect(actionSchema.safeParse({ text: ` ${'a'.repeat(1000)} `, stake: 0 }).success).toBe(true);
  });

  it('rejects an empty or blank action', () => {
    expect(actionSchema.safeParse({ text: '', stake: 0 }).success).toBe(false);
    expect(actionSchema.safeParse({ text: ' \n\t ', stake: 0 }).success).toBe(false);
  });

  it('rejects unknown fields, so the client cannot smuggle data in', () => {
    expect(actionSchema.safeParse({ text: 'Huyo.', stake: 0, playerId: 'x' }).success).toBe(false);
  });

  it('requires a whole, non-negative stake', () => {
    expect(actionSchema.safeParse({ text: 'Huyo.' }).success).toBe(false);
    expect(actionSchema.safeParse({ text: 'Huyo.', stake: -1 }).success).toBe(false);
    expect(actionSchema.safeParse({ text: 'Huyo.', stake: 1.5 }).success).toBe(false);
    expect(actionSchema.safeParse({ text: 'Huyo.', stake: '2' }).success).toBe(false);
  });
});
