import { describe, expect, it } from 'vitest';

import { actionReplySchema, apiErrorReplySchema, hintReplySchema } from './api-replies.ts';

describe('actionReplySchema', () => {
  it('reads the game day the action was stored for', () => {
    expect(actionReplySchema.parse({ day: '2026-11-09' })).toEqual({ day: '2026-11-09' });
  });

  it('rejects anything that is not a date', () => {
    expect(actionReplySchema.safeParse({ day: 'mañana' }).success).toBe(false);
    expect(actionReplySchema.safeParse({}).success).toBe(false);
  });
});

describe('hintReplySchema', () => {
  it('reads the hint and whether it is the censor line', () => {
    expect(hintReplySchema.parse({ text: 'Cuidado con el aceite.', censored: false })).toEqual({
      text: 'Cuidado con el aceite.',
      censored: false,
    });
  });

  it('rejects an empty hint or a missing flag', () => {
    expect(hintReplySchema.safeParse({ text: '', censored: false }).success).toBe(false);
    expect(hintReplySchema.safeParse({ text: 'Pista.' }).success).toBe(false);
  });
});

describe('apiErrorReplySchema', () => {
  it('reads an error code', () => {
    expect(apiErrorReplySchema.parse({ error: 'day_closed' })).toEqual({ error: 'day_closed' });
  });

  it('rejects free text where a code belongs', () => {
    expect(apiErrorReplySchema.safeParse({ error: 'Something went wrong.' }).success).toBe(false);
    expect(apiErrorReplySchema.safeParse({ message: 'x' }).success).toBe(false);
  });
});
