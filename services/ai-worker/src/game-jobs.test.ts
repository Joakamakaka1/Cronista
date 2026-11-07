import type { ParametersResult } from '@cronista/parameters';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGameJobs } from './game-jobs.ts';
import type { Provider } from './handler.ts';

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

/** Answers the two reads of a spend check, with this much spent in `game-prod`. */
const ledgerAnswering =
  (spent: number): typeof fetch =>
  (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    const body = url.includes('spend_by_workspace') ? { 'game-prod': spent } : [];
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };

function jobs(
  publishAlert: (subject: string, message: string) => Promise<void>,
  keys: ParametersResult<Provider> = allKeys,
) {
  const reportOwnerNotTold = vi.fn();
  return {
    reportOwnerNotTold,
    gameJobs: createGameJobs({
      readKeys: () => Promise.resolve(keys),
      supabaseUrl: 'https://invented.example.com',
      langfuseUrl: 'https://langfuse.example.com',
      readBible: () => Promise.resolve(undefined),
      publishAlert,
      reportOwnerNotTold,
      queueNotification: () => Promise.resolve(),
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the spend check of a job', () => {
  it('sends its alert, with nothing to report', async () => {
    vi.stubGlobal('fetch', ledgerAnswering(8));
    const publishAlert = vi.fn(() => Promise.resolve());
    const { gameJobs, reportOwnerNotTold } = jobs(publishAlert);

    await gameJobs.checkSpend();

    expect(publishAlert).toHaveBeenCalledOnce();
    expect(reportOwnerNotTold).not.toHaveBeenCalled();
  });

  it('never fails the job when an alert cannot go out, and reports that nobody was told', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', ledgerAnswering(8));
    const { gameJobs, reportOwnerNotTold } = jobs(() => Promise.reject(new Error('sns')));

    await expect(gameJobs.checkSpend()).resolves.toBeUndefined();

    expect(reportOwnerNotTold).toHaveBeenCalledOnce();
  });

  it('never fails the job when the ledger cannot be read, and reports it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('{"code":"XX000"}', { status: 500 })),
    );
    const { gameJobs, reportOwnerNotTold } = jobs(() => Promise.resolve());

    await expect(gameJobs.checkSpend()).resolves.toBeUndefined();

    expect(reportOwnerNotTold).toHaveBeenCalledOnce();
  });

  it('never fails the job when the keys cannot be read, and reports it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { gameJobs, reportOwnerNotTold } = jobs(() => Promise.resolve(), {
      ok: false,
      error: { unreadable: ['anthropic'] },
    });

    await expect(gameJobs.checkSpend()).resolves.toBeUndefined();

    expect(reportOwnerNotTold).toHaveBeenCalledOnce();
  });
});
