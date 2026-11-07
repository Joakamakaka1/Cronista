import type { GameLoopCheck } from '@cronista/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHandler, type NotifierDependencies } from './handler.ts';

// 19:00 CET on 2026-10-31, the first reminder of that game day.
const reminder = JSON.stringify({ type: 'reminder', scheduledTime: '2026-10-31T18:00:00Z' });
// 22:30 CET on 2026-10-31, the deadline of that game day's close.
const gameLoopCheck: GameLoopCheck = {
  type: 'game-loop-check',
  job: 'close-day',
  scheduledTime: '2026-10-31T21:30:00Z',
};
const report = { sent: 2, gone: 1, failed: 0 };

afterEach(() => {
  vi.restoreAllMocks();
});

// An SQS event as the event source mapping delivers it, one record per body.
function sqsEvent(...bodies: string[]) {
  return {
    Records: bodies.map((body, index) => ({
      messageId: `message-${index}`,
      receiptHandle: `receipt-${index}`,
      body,
      attributes: { ApproximateReceiveCount: '1' },
      eventSource: 'aws:sqs',
    })),
  };
}

function handlerWith() {
  const sendPushes = vi.fn<NotifierDependencies['sendPushes']>(() =>
    Promise.resolve({ ok: true, value: report }),
  );
  const checkGameLoop = vi.fn<NotifierDependencies['checkGameLoop']>(() => Promise.resolve());
  const watchSite = vi.fn<NotifierDependencies['watchSite']>(() => Promise.resolve());
  return {
    handler: createHandler({ sendPushes, checkGameLoop, watchSite }),
    sendPushes,
    checkGameLoop,
    watchSite,
  };
}

describe('notifier', () => {
  it('sends the pushes of each reminder and logs how they went', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler, sendPushes, checkGameLoop } = handlerWith();

    expect(await handler(sqsEvent(reminder, reminder))).toEqual({ batchItemFailures: [] });
    expect(sendPushes).toHaveBeenCalledTimes(2);
    expect(sendPushes).toHaveBeenCalledWith(JSON.parse(reminder));
    expect(info).toHaveBeenCalledWith({ message: 'pushes sent', type: 'reminder', ...report });
    expect(checkGameLoop).not.toHaveBeenCalled();
  });

  it.each([
    { type: 'day-opened', day: '2026-11-09' },
    { type: 'chapter-published', day: '2026-11-09' },
    { type: 'chapter-postponed', day: '2026-11-09' },
    { type: 'player-played', day: '2026-11-09', characterId: 2 },
  ])('sends the pushes of a $type message the game queued', async (notification) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler, sendPushes } = handlerWith();

    expect(await handler(sqsEvent(JSON.stringify(notification)))).toEqual({
      batchItemFailures: [],
    });
    expect(sendPushes).toHaveBeenCalledExactlyOnceWith(notification);
  });

  it('reports a notification whose pushes could not go out as failed, so the queue retries it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler, sendPushes } = handlerWith();
    sendPushes.mockResolvedValueOnce({ ok: false, error: 'vapid_keys_unreadable' });

    expect(await handler(sqsEvent(reminder, reminder))).toEqual({
      batchItemFailures: [{ itemIdentifier: 'message-0' }],
    });
    expect(error).toHaveBeenCalledExactlyOnceWith({
      message: 'pushes not sent',
      messageId: 'message-0',
      type: 'reminder',
      error: 'vapid_keys_unreadable',
    });
  });

  it('reports each message that is not a notification as failed, logging only its ID', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler } = handlerWith();

    const chapter = JSON.stringify({ type: 'chapter', text: 'Capítulo secreto' });
    expect(await handler(sqsEvent('not json', reminder, chapter))).toEqual({
      batchItemFailures: [{ itemIdentifier: 'message-0' }, { itemIdentifier: 'message-2' }],
    });
    expect(warn.mock.calls).toEqual([
      [{ message: 'invalid notification', messageId: 'message-0' }],
      [{ message: 'invalid notification', messageId: 'message-2' }],
    ]);
  });

  it('sends nothing for a message that is not a notification', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { handler, sendPushes } = handlerWith();

    await handler(sqsEvent('{}'));
    expect(sendPushes).not.toHaveBeenCalled();
  });

  it('fails the whole batch when the event is not an SQS event', async () => {
    const { handler } = handlerWith();
    await expect(handler({ detail: reminder })).rejects.toThrow();
  });

  describe('site checks', () => {
    const siteCheck = JSON.stringify({ type: 'site-check', scheduledTime: '2026-10-31T18:00:00Z' });

    it('runs the check and sends no push, and reports no failure', async () => {
      const { handler, sendPushes, checkGameLoop, watchSite } = handlerWith();

      expect(await handler(sqsEvent(siteCheck))).toEqual({ batchItemFailures: [] });
      expect(watchSite).toHaveBeenCalledOnce();
      expect(sendPushes).not.toHaveBeenCalled();
      expect(checkGameLoop).not.toHaveBeenCalled();
    });

    it('rejects a site check with extra fields, without running it', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { handler, watchSite } = handlerWith();

      const forged = JSON.stringify({
        type: 'site-check',
        scheduledTime: '2026-10-31T18:00:00Z',
        url: 'https://x',
      });
      expect(await handler(sqsEvent(forged))).toEqual({
        batchItemFailures: [{ itemIdentifier: 'message-0' }],
      });
      expect(watchSite).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledOnce();
    });
  });

  describe('game-loop checks', () => {
    it('runs the check and sends no push', async () => {
      const { handler, sendPushes, checkGameLoop } = handlerWith();

      expect(await handler(sqsEvent(JSON.stringify(gameLoopCheck)))).toEqual({
        batchItemFailures: [],
      });
      expect(checkGameLoop).toHaveBeenCalledExactlyOnceWith(gameLoopCheck);
      expect(sendPushes).not.toHaveBeenCalled();
    });

    it('reports only the failed check, so the queue retries it and the rest of the batch goes on', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const { handler, checkGameLoop } = handlerWith();
      checkGameLoop.mockRejectedValueOnce(new TypeError('topic unreachable'));

      expect(await handler(sqsEvent(reminder, JSON.stringify(gameLoopCheck)))).toEqual({
        batchItemFailures: [{ itemIdentifier: 'message-1' }],
      });
      expect(error).toHaveBeenCalledExactlyOnceWith({
        message: 'game loop check failed',
        messageId: 'message-1',
        job: 'close-day',
        error: 'TypeError',
      });
    });
  });
});
