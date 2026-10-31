import type { ParametersResult } from '@cronista/parameters';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHandler, type VapidKey } from './handler.ts';

// 19:00 CET on 2026-10-31, the first reminder of that game day.
const reminder = JSON.stringify({ type: 'reminder', scheduledTime: '2026-10-31T18:00:00Z' });
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
  return { handler: createHandler({ readVapidKeys }), readVapidKeys };
}

describe('notifier', () => {
  it('logs each reminder with its game day and reports no failures', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { handler, readVapidKeys } = handlerWith(vapidKeys);

    expect(await handler(sqsEvent(reminder, reminder))).toEqual({ batchItemFailures: [] });
    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledWith({ message: 'reminder not implemented', day: '2026-10-31' });
    expect(readVapidKeys).toHaveBeenCalledOnce();
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
});
