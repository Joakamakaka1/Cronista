import type { GameLoopCheck } from '@cronista/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGameLoopCheck, type GameLoopCheckDependencies } from './game-loop-check.ts';

// 08:30 CET on 2026-11-02 and 22:30 CEST on 2026-07-01: the deadlines of those game days.
const openingCheck: GameLoopCheck = {
  type: 'game-loop-check',
  job: 'open-day',
  scheduledTime: '2026-11-02T07:30:00Z',
};
const closingCheck: GameLoopCheck = {
  type: 'game-loop-check',
  job: 'close-day',
  scheduledTime: '2026-07-01T20:30:00Z',
};

afterEach(() => {
  vi.restoreAllMocks();
});

function checkWith(completions: number) {
  const countCompletions = vi.fn<GameLoopCheckDependencies['countCompletions']>(() =>
    Promise.resolve(completions),
  );
  const publishAlert = vi.fn<GameLoopCheckDependencies['publishAlert']>(() => Promise.resolve());
  const reportChecked = vi.fn();
  return {
    check: createGameLoopCheck({ countCompletions, publishAlert, reportChecked }),
    countCompletions,
    publishAlert,
    reportChecked,
  };
}

describe('the game-loop check', () => {
  it('reads the job over the hour before its deadline', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { check, countCompletions } = checkWith(1);

    await check(openingCheck);

    expect(countCompletions).toHaveBeenCalledExactlyOnceWith(
      'open-day',
      new Date('2026-11-02T06:30:00Z'),
      new Date('2026-11-02T07:30:00Z'),
    );
  });

  it('stays quiet when the job reported, and logs that it checked', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { check, publishAlert } = checkWith(1);

    await check(openingCheck);

    expect(publishAlert).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledExactlyOnceWith({
      message: 'game loop check',
      job: 'open-day',
      day: '2026-11-02',
      completions: 1,
    });
  });

  it('counts a retry as a report: two completions still mean the job ran', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { check, publishAlert } = checkWith(2);

    await check(openingCheck);

    expect(publishAlert).not.toHaveBeenCalled();
  });

  it('alerts with the game day and the deadline when the opening did not report', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { check, publishAlert } = checkWith(0);

    await check(openingCheck);

    expect(publishAlert).toHaveBeenCalledOnce();
    const [subject, message] = publishAlert.mock.calls[0] ?? [];
    expect(subject).toBe('Cronista: the day was not opened');
    expect(message).toContain('open-day');
    expect(message).toContain('2026-11-02');
    expect(message).toContain('08:30');
  });

  it('alerts the same way when the close did not report, in summer time too', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { check, publishAlert } = checkWith(0);

    await check(closingCheck);

    const [subject, message] = publishAlert.mock.calls[0] ?? [];
    expect(subject).toBe('Cronista: the day was not closed');
    expect(message).toContain('close-day');
    expect(message).toContain('2026-07-01');
    expect(message).toContain('22:30');
  });

  it.each([
    ['the job reported', 1],
    ['the job did not report', 0],
  ])('tells the heartbeat alarm it ran when %s', async (_, completions) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { check, reportChecked } = checkWith(completions);

    await check(openingCheck);

    expect(reportChecked).toHaveBeenCalledOnce();
  });

  it('fails without a heartbeat when the alert cannot be sent, so the queue retries it', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { check, publishAlert, reportChecked } = checkWith(0);
    publishAlert.mockRejectedValueOnce(new Error('topic unreachable'));

    await expect(check(openingCheck)).rejects.toThrow('topic unreachable');

    expect(reportChecked).not.toHaveBeenCalled();
  });
});
