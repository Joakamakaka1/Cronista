import { functionUrlEvent } from '@cronista/http/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEntryPoint } from './entry-point.ts';
import type { SiteCheckReport } from './site-check.ts';

const report: SiteCheckReport = {
  root: { status: 200, cacheControl: 'no-cache', contentType: 'text/html', sha256: 'abc' },
  me: { status: 401 },
  hint: { status: 401 },
};

afterEach(() => {
  vi.restoreAllMocks();
});

function entryPoint() {
  const http = vi.fn(() => Promise.resolve({ statusCode: 401 }));
  const checkSite = vi.fn(() => Promise.resolve(report));
  return { handler: createEntryPoint({ http, checkSite }), http, checkSite };
}

describe('core-api entry point', () => {
  it('runs the site check on a direct invocation, and logs its report', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler, http } = entryPoint();

    expect(await handler({ check: 'site' })).toEqual(report);
    expect(http).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledExactlyOnceWith({ message: 'site check', ...report });
  });

  it('sends every Function URL request to the HTTP handler', async () => {
    const { handler, checkSite } = entryPoint();
    const event = functionUrlEvent({ method: 'GET', path: '/api/me' });

    expect(await handler(event)).toEqual({ statusCode: 401 });
    expect(checkSite).not.toHaveBeenCalled();
  });

  it('rejects a direct invocation with anything else', async () => {
    const { handler, checkSite } = entryPoint();
    // A hand-made invocation is not typed: this is what a wrong payload looks like at runtime.
    const event = JSON.parse('{"check":"site","url":"https://x"}') as { check: 'site' };

    await expect(handler(event)).rejects.toThrow('invalid site check');
    expect(checkSite).not.toHaveBeenCalled();
  });
});
