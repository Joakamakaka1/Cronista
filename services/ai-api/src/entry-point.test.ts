import { functionUrlEvent } from '@cronista/http/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEntryPoint } from './entry-point.ts';
import type { ProviderCheckReport } from './provider-check.ts';

const report: ProviderCheckReport = {
  status: 'checked',
  anthropic: 'ok',
  voyage: 'ok',
  langfuse: 'ok',
  traceId: '0123456789abcdef0123456789abcdef',
};

afterEach(() => {
  vi.restoreAllMocks();
});

function entryPoint() {
  const http = vi.fn(() => Promise.resolve({ statusCode: 401 }));
  const checkProviders = vi.fn(() => Promise.resolve(report));
  return { handler: createEntryPoint({ http, checkProviders }), http, checkProviders };
}

describe('ai-api entry point', () => {
  it('runs the provider check on a direct invocation, and logs its report', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler, http } = entryPoint();

    expect(await handler({ check: 'providers' })).toEqual(report);
    expect(http).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledExactlyOnceWith({ message: 'provider check', ...report });
  });

  it('sends every Function URL request to the HTTP handler', async () => {
    const { handler, checkProviders } = entryPoint();
    const event = functionUrlEvent({ method: 'POST', path: '/api/ai/hint', body: '{}' });

    expect(await handler(event)).toEqual({ statusCode: 401 });
    expect(checkProviders).not.toHaveBeenCalled();
  });

  it('rejects a direct invocation with anything else', async () => {
    const { handler, checkProviders } = entryPoint();
    // A hand-made invocation is not typed: this is what a wrong payload looks like at runtime.
    const event = JSON.parse('{"check":"providers","key":"x"}') as { check: 'providers' };

    await expect(handler(event)).rejects.toThrow('invalid provider check');
    expect(checkProviders).not.toHaveBeenCalled();
  });
});
