import type { CloseDayResult, OpenDayResult } from '@cronista/engine';
import type { ParametersResult } from '@cronista/parameters';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type AiWorkerDependencies, createHandler, type Provider } from './handler.ts';
import type { PingResult } from './keep-alive.ts';

// 22:00 CET on 2026-10-31: the close of that game day.
const closeDay = { job: 'close-day', scheduledTime: '2026-10-31T21:00:00Z' };
// 08:00 CET on 2026-10-31: the opening of that game day.
const openDay = { job: 'open-day', scheduledTime: '2026-10-31T07:00:00Z' };
const allKeys: ParametersResult<Provider> = {
  ok: true,
  value: {
    anthropic: 'invented-a',
    voyage: 'invented-v',
    langfuse: 'invented-l',
    langfusePublic: 'invented-p',
    supabase: 'invented-s',
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// 04:00 CET on 2026-11-01: the keep-alive of that game day.
const keepAlive = { job: 'keep-alive', scheduledTime: '2026-11-01T03:00:00Z' };

function handlerWith(
  keys: ParametersResult<Provider>,
  ping: PingResult = { ok: true },
  results: { readonly opened?: OpenDayResult; readonly closed?: CloseDayResult } = {},
) {
  const readProviderKeys = vi.fn(() => Promise.resolve(keys));
  const pingDatabase = vi.fn(() => Promise.resolve(ping));
  const reportJobCompleted = vi.fn();
  const flushTraces = vi.fn(() => Promise.resolve());
  const runOpenDay = vi.fn<AiWorkerDependencies['openDay']>(() =>
    Promise.resolve(results.opened ?? { ok: true, value: 'opened' }),
  );
  const runCloseDay = vi.fn<AiWorkerDependencies['closeDay']>(() =>
    Promise.resolve(results.closed ?? { ok: true, value: { status: 'published' } }),
  );
  return {
    handler: createHandler({
      readProviderKeys,
      pingDatabase,
      openDay: runOpenDay,
      closeDay: runCloseDay,
      flushTraces,
      reportJobCompleted,
    }),
    readProviderKeys,
    pingDatabase,
    runOpenDay,
    runCloseDay,
    flushTraces,
    reportJobCompleted,
  };
}

describe('ai-worker', () => {
  it('runs the close for the day it was scheduled for, and reports what happened', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler, runCloseDay, flushTraces } = handlerWith(allKeys);

    expect(await handler(closeDay)).toEqual({
      job: 'close-day',
      day: '2026-10-31',
      status: 'published',
    });
    expect(runCloseDay).toHaveBeenCalledExactlyOnceWith('2026-10-31');
    expect(flushTraces).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledExactlyOnceWith({
      message: 'job finished',
      job: 'close-day',
      day: '2026-10-31',
      status: 'published',
    });
  });

  it('runs the opening for the day it was scheduled for', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler, runOpenDay } = handlerWith(allKeys);

    expect(await handler(openDay)).toEqual({
      job: 'open-day',
      day: '2026-10-31',
      status: 'opened',
    });
    expect(runOpenDay).toHaveBeenCalledExactlyOnceWith('2026-10-31');
  });

  it.each([openDay, closeDay])('reports $job as completed when it succeeds', async (event) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler, reportJobCompleted } = handlerWith(allKeys);

    await handler(event);

    expect(reportJobCompleted).toHaveBeenCalledExactlyOnceWith(event.job);
  });

  it.each([
    ['no_active_season', { ok: true, value: 'no_active_season' }],
    ['already_open', { ok: true, value: 'already_open' }],
  ] as const)('reports the opening as completed on %s', async (status, opened) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler, reportJobCompleted } = handlerWith(allKeys, undefined, { opened });

    expect((await handler(openDay)).status).toBe(status);
    expect(reportJobCompleted).toHaveBeenCalledExactlyOnceWith('open-day');
  });

  it.each([
    ['no_active_season', { ok: true, value: { status: 'no_active_season' } }],
    ['already_published', { ok: true, value: { status: 'already_published' } }],
  ] as const)('reports the close as completed on %s', async (status, closed) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler, reportJobCompleted } = handlerWith(allKeys, undefined, { closed });

    expect((await handler(closeDay)).status).toBe(status);
    expect(reportJobCompleted).toHaveBeenCalledExactlyOnceWith('close-day');
  });

  it.each([['previous_day_unresolved'], ['bible_mismatch'], ['situation_failed']] as const)(
    'does not report or throw when the day cannot open: %s',
    async (error) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { handler, reportJobCompleted, flushTraces } = handlerWith(allKeys, undefined, {
        opened: { ok: false, error },
      });

      expect((await handler(openDay)).status).toBe(error);
      expect(reportJobCompleted).not.toHaveBeenCalled();
      expect(flushTraces).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledOnce();
    },
  );

  it.each([['bible_unavailable'], ['situation_unavailable']] as const)(
    'throws when the day cannot open for an outage, so that Lambda retries it: %s',
    async (error) => {
      const { handler, reportJobCompleted, flushTraces } = handlerWith(allKeys, undefined, {
        opened: { ok: false, error },
      });

      await expect(handler(openDay)).rejects.toThrow(error);
      expect(reportJobCompleted).not.toHaveBeenCalled();
      expect(flushTraces).toHaveBeenCalledOnce();
    },
  );

  it.each([['resolve_refused'], ['resolve_invalid'], ['narrate_spend_limit']] as const)(
    'does not report or throw on a chapter postponed for what a retry would repeat: %s',
    async (reason) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { handler, reportJobCompleted, flushTraces } = handlerWith(allKeys, undefined, {
        closed: { ok: true, value: { status: 'postponed', reason } },
      });

      expect((await handler(closeDay)).status).toBe(`postponed: ${reason}`);
      expect(reportJobCompleted).not.toHaveBeenCalled();
      expect(flushTraces).toHaveBeenCalledOnce();
    },
  );

  it.each([['resolve_technical'], ['narrate_technical'], ['bible_unavailable']] as const)(
    'throws on a chapter postponed for an outage, so that Lambda runs the close again: %s',
    async (reason) => {
      const { handler, reportJobCompleted, flushTraces } = handlerWith(allKeys, undefined, {
        closed: { ok: true, value: { status: 'postponed', reason } },
      });

      await expect(handler(closeDay)).rejects.toThrow(reason);
      expect(reportJobCompleted).not.toHaveBeenCalled();
      expect(flushTraces).toHaveBeenCalledOnce();
    },
  );

  it.each([['no_open_day'], ['too_early']] as const)(
    'does not report or throw when the close cannot run: %s',
    async (error) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { handler, reportJobCompleted } = handlerWith(allKeys, undefined, {
        closed: { ok: false, error },
      });

      expect((await handler(closeDay)).status).toBe(error);
      expect(reportJobCompleted).not.toHaveBeenCalled();
    },
  );

  it('throws when the database does not answer, so that Lambda retries the job', async () => {
    const { handler, reportJobCompleted, flushTraces } = handlerWith(allKeys, undefined, {
      closed: { ok: false, error: 'store_unavailable' },
      opened: { ok: false, error: 'store_unavailable' },
    });

    await expect(handler(closeDay)).rejects.toThrow('store_unavailable');
    await expect(handler(openDay)).rejects.toThrow('store_unavailable');
    expect(reportJobCompleted).not.toHaveBeenCalled();
    expect(flushTraces).toHaveBeenCalledTimes(2);
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
