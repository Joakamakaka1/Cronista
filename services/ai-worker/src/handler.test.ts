import type { ParametersResult } from '@cronista/parameters';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHandler, type Provider } from './handler.ts';
import type { PingResult } from './keep-alive.ts';

// 22:00 CET on 2026-10-31: the close of that game day.
const closeDay = { job: 'close-day', scheduledTime: '2026-10-31T21:00:00Z' };
const allKeys: ParametersResult<Provider> = {
  ok: true,
  value: { anthropic: 'invented-a', voyage: 'invented-v', langfuse: 'invented-l' },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// 04:00 CET on 2026-11-01: the keep-alive of that game day.
const keepAlive = { job: 'keep-alive', scheduledTime: '2026-11-01T03:00:00Z' };

function handlerWith(keys: ParametersResult<Provider>, ping: PingResult = { ok: true }) {
  const readProviderKeys = vi.fn(() => Promise.resolve(keys));
  const pingDatabase = vi.fn(() => Promise.resolve(ping));
  const reportJobCompleted = vi.fn();
  return {
    handler: createHandler({ readProviderKeys, pingDatabase, reportJobCompleted }),
    readProviderKeys,
    pingDatabase,
    reportJobCompleted,
  };
}

describe('ai-worker', () => {
  it('reports the job and its game day once the provider keys are readable', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler } = handlerWith(allKeys);

    expect(await handler(closeDay)).toEqual({
      job: 'close-day',
      day: '2026-10-31',
      status: 'not_implemented',
    });
    expect(info).toHaveBeenCalledExactlyOnceWith({
      message: 'job not implemented',
      job: 'close-day',
      day: '2026-10-31',
    });
  });

  it.each(['open-day', 'close-day'])('reports %s as completed when it succeeds', async (job) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler, reportJobCompleted } = handlerWith(allKeys);

    await handler({ job, scheduledTime: closeDay.scheduledTime });

    expect(reportJobCompleted).toHaveBeenCalledExactlyOnceWith(job);
  });

  it('reports nothing when the job fails, so its deadline raises an alert', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { handler, reportJobCompleted } = handlerWith({
      ok: false,
      error: { unreadable: ['anthropic'] },
    });

    await expect(handler(closeDay)).rejects.toThrow();

    expect(reportJobCompleted).not.toHaveBeenCalled();
  });

  it('names the day the job was scheduled for, even when a retry runs after midnight', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.useFakeTimers({ now: new Date('2026-11-01T00:30:00Z') });
    const { handler } = handlerWith(allKeys);

    expect(await handler(closeDay)).toMatchObject({ day: '2026-10-31' });
  });

  it('fails when a provider key cannot be read, and logs only which one', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { handler } = handlerWith({ ok: false, error: { unreadable: ['anthropic'] } });

    await expect(handler(closeDay)).rejects.toThrow('provider keys');
    expect(error).toHaveBeenCalledExactlyOnceWith({
      message: 'provider keys unreadable',
      job: 'close-day',
      day: '2026-10-31',
      unreadable: ['anthropic'],
    });
  });

  it.each([
    ['an unknown job', { job: 'publish', scheduledTime: closeDay.scheduledTime }],
    ['no scheduled time', { job: 'open-day' }],
    ['no job at all', 'close-day'],
  ])('fails on %s before reading the keys, logging no input value', async (_, event) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { handler, readProviderKeys } = handlerWith(allKeys);

    await expect(handler(event)).rejects.toThrow('invalid job');
    expect(readProviderKeys).not.toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/publish|close-day/);
  });

  describe('keep-alive', () => {
    it('pings the database without reading the provider keys', async () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const { handler, readProviderKeys, pingDatabase, reportJobCompleted } = handlerWith({
        ok: false,
        error: { unreadable: ['anthropic'] },
      });

      expect(await handler(keepAlive)).toEqual({
        job: 'keep-alive',
        day: '2026-11-01',
        status: 'awake',
      });
      expect(pingDatabase).toHaveBeenCalledOnce();
      expect(readProviderKeys).not.toHaveBeenCalled();
      // It has no deadline to report to.
      expect(reportJobCompleted).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledExactlyOnceWith({
        message: 'database awake',
        job: 'keep-alive',
        day: '2026-11-01',
      });
    });

    it('fails when the ping does not reach the database, and logs only why', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { handler } = handlerWith(allKeys, {
        ok: false,
        error: { reason: 'rejected', status: 401 },
      });

      await expect(handler(keepAlive)).rejects.toThrow('database');
      expect(error).toHaveBeenCalledExactlyOnceWith({
        message: 'database ping failed',
        job: 'keep-alive',
        day: '2026-11-01',
        reason: 'rejected',
        status: 401,
      });
    });
  });
});
