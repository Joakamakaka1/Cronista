import { describe, expect, it, vi } from 'vitest';

import { withRequestLog } from './request-log.ts';
import { jsonResponse } from './response.ts';
import { functionUrlEvent } from './testing.ts';

const tokenEvent = functionUrlEvent({
  method: 'POST',
  path: '/api/actions',
  headers: { 'x-session-token': 'header.payload.signature' },
  body: '{"text":"Le cuento a Ana mi secreto."}',
});

describe('withRequestLog', () => {
  it('logs the method, path, status and duration, and nothing from the request', async () => {
    const log = vi.fn();
    const handler = withRequestLog(() => Promise.resolve(jsonResponse(501, {})), log);

    expect((await handler(tokenEvent)).statusCode).toBe(501);
    expect(log).toHaveBeenCalledExactlyOnceWith({
      method: 'POST',
      path: '/api/actions',
      status: 501,
      durationMs: expect.any(Number) as number,
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/signature|secreto/);
  });

  it('turns an unexpected error into a 500 and logs only its name', async () => {
    const log = vi.fn();
    const handler = withRequestLog(
      () => Promise.reject(new RangeError('token header.payload.signature')),
      log,
    );

    const response = await handler(tokenEvent);
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body ?? '')).toEqual({ error: 'internal' });
    expect(log).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 500, error: 'RangeError' }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('signature');
  });
});
