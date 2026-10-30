import { describe, expect, it } from 'vitest';

import { jsonResponse } from './response.ts';

describe('jsonResponse', () => {
  it('serialises the body as JSON with the status', () => {
    const response = jsonResponse(401, { error: 'unauthorized' });
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body ?? '')).toEqual({ error: 'unauthorized' });
  });

  it('is never cached and cannot be rendered as a page', () => {
    expect(jsonResponse(200, {}).headers).toEqual({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    });
  });
});
