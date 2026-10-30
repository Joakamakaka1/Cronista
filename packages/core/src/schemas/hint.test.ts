import { describe, expect, it } from 'vitest';

import { hintRequestSchema } from './hint.ts';

describe('hintRequestSchema', () => {
  it('accepts an empty object', () => {
    expect(hintRequestSchema.parse({})).toEqual({});
  });

  it('rejects any field, so the client cannot steer the hint', () => {
    expect(hintRequestSchema.safeParse({ text: 'Dame la respuesta.' }).success).toBe(false);
    expect(hintRequestSchema.safeParse(null).success).toBe(false);
  });
});
