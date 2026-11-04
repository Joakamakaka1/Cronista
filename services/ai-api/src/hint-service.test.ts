import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHintService } from './hint-service.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createHintService', () => {
  it('answers that the providers are not configured when a key cannot be read, logging which', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = createHintService({
      readKeys: () => Promise.resolve({ ok: false, error: { unreadable: ['anthropic'] } }),
      supabaseUrl: 'https://invented.supabase.co',
      langfuseUrl: 'https://invented.langfuse.test',
      readBible: () => Promise.resolve(undefined),
    });

    expect(await service.requestHint('a-user')).toEqual({
      ok: false,
      error: 'providers_not_configured',
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      message: 'provider keys unreadable',
      unreadable: ['anthropic'],
    });
  });

  it('has nothing to flush before the first hint', async () => {
    const service = createHintService({
      readKeys: () => Promise.resolve({ ok: false, error: { unreadable: ['anthropic'] } }),
      supabaseUrl: 'https://invented.supabase.co',
      langfuseUrl: 'https://invented.langfuse.test',
      readBible: () => Promise.resolve(undefined),
    });

    await expect(service.flushTraces()).resolves.toBeUndefined();
  });
});
