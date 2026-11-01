import type { GameLoopCheck } from '@cronista/core';
import type { ParametersResult } from '@cronista/parameters';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHandler, type NotifierDependencies, type VapidKey } from './handler.ts';

// 19:00 CET on 2026-10-31, the first reminder of that game day.
const reminder = JSON.stringify({ type: 'reminder', scheduledTime: '2026-10-31T18:00:00Z' });
// 22:30 CET on 2026-10-31, the deadline of that game day's close.
const gameLoopCheck: GameLoopCheck = {
  type: 'game-loop-check',
  job: 'close-day',
  scheduledTime: '2026-10-31T21:30:00Z',
};
const vapidKeys: ParametersResult<VapidKey> = {
  ok: true,
  value: { privateKey: 'invented-private', publicKey: 'invented-public' },
};

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

function handlerWith(keys: ParametersResult<VapidKey>) {
  const readVapidKeys = vi.fn(() => Promise.resolve(keys));
  const checkGameLoop = vi.fn<NotifierDependencies['checkGameLoop']>(() => Promise.resolve());
  return { handler: createHandler({ readVapidKeys, checkGameLoop }), readVapidKeys, checkGameLoop };
}

describe('notifier', () => {
  it('logs each reminder with its game day and reports no failures', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler, readVapidKeys, checkGameLoop } = handlerWith(vapidKeys);

    expect(await handler(sqsEvent(reminder, reminder))).toEqual({ batchItemFailures: [] });
    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledWith({ message: 'reminder not implemented', day: '2026-10-31' });
    expect(readVapidKeys).toHaveBeenCalledOnce();
    expect(checkGameLoop).not.toHaveBeenCalled();
  });

  it('reports each message that is not a notification as failed, logging only its ID', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler } = handlerWith(vapidKeys);

    const chapter = JSON.stringify({ type: 'chapter', text: 'Capítulo secreto' });
    expect(await handler(sqsEvent('not json', reminder, chapter))).toEqual({
      batchItemFailures: [{ itemIdentifier: 'message-0' }, { itemIdentifier: 'message-2' }],
    });
    expect(warn.mock.calls).toEqual([
      [{ message: 'invalid notification', messageId: 'message-0' }],
      [{ message: 'invalid notification', messageId: 'message-2' }],
    ]);
  });

  it('warns without failing while the VAPID keys cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler } = handlerWith({ ok: false, error: { unreadable: ['privateKey'] } });

    expect(await handler(sqsEvent(reminder))).toEqual({ batchItemFailures: [] });
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      message: 'vapid keys unreadable',
      unreadable: ['privateKey'],
    });
  });

  it('reads no keys for a batch without notifications to send', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { handler, readVapidKeys } = handlerWith(vapidKeys);

    await handler(sqsEvent('{}'));
    expect(readVapidKeys).not.toHaveBeenCalled();
  });

  it('fails the whole batch when the event is not an SQS event', async () => {
    const { handler } = handlerWith(vapidKeys);
    await expect(handler({ detail: reminder })).rejects.toThrow();
  });

  describe('game-loop checks', () => {
    it('runs the check without the VAPID keys, which it does not need', async () => {
      const { handler, readVapidKeys, checkGameLoop } = handlerWith(vapidKeys);

      expect(await handler(sqsEvent(JSON.stringify(gameLoopCheck)))).toEqual({
        batchItemFailures: [],
      });
      expect(checkGameLoop).toHaveBeenCalledExactlyOnceWith(gameLoopCheck);
      expect(readVapidKeys).not.toHaveBeenCalled();
    });

    it('reports only the failed check, so the queue retries it and the rest of the batch goes on', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const { handler, checkGameLoop } = handlerWith(vapidKeys);
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
