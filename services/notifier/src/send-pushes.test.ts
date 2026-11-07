import type { PushSubscription } from '@cronista/core';
import type { GameStore } from '@cronista/engine';
import type { ParametersResult } from '@cronista/parameters';
import { describe, expect, it, vi } from 'vitest';

import type { PushOutcome, SendPush, VapidKeys } from './push-sender.ts';
import { createPushDelivery } from './send-pushes.ts';

const keys: ParametersResult<keyof VapidKeys> = {
  ok: true,
  value: { privateKey: 'invented-private', publicKey: 'invented-public' },
};

const subscription = (name: string): PushSubscription => ({
  endpoint: `https://web.push.apple.com/${name}`,
  keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) },
});

function delivery(
  recipients: readonly PushSubscription[],
  outcomes: Readonly<Record<string, PushOutcome>> = {},
  vapid: ParametersResult<keyof VapidKeys> = keys,
) {
  const store = {
    pushRecipients: vi.fn<GameStore['pushRecipients']>(() =>
      Promise.resolve({ ok: true, value: recipients }),
    ),
    removePushSubscription: vi.fn(() => Promise.resolve({ ok: true as const, value: undefined })),
    nicknameOf: vi.fn(() => Promise.resolve({ ok: true as const, value: 'La Rata' })),
  };
  const send = vi.fn<SendPush>((target) =>
    Promise.resolve(outcomes[target.endpoint] ?? ('sent' as const)),
  );
  const readVapidKeys = vi.fn(() => Promise.resolve(vapid));
  return {
    store,
    send,
    readVapidKeys,
    sendPushes: createPushDelivery({ store, readVapidKeys, pushSender: () => send }),
  };
}

describe('createPushDelivery', () => {
  it('sends the reminder to whoever is missing now, with its text and a short life', async () => {
    const { sendPushes, send, store } = delivery([subscription('ana')]);

    const sent = await sendPushes({ type: 'reminder', scheduledTime: '2026-11-09T20:00:00Z' });

    expect(sent).toEqual({ ok: true, value: { sent: 1, gone: 0, failed: 0 } });
    expect(store.pushRecipients).toHaveBeenCalledWith({ day: '2026-11-09', onlyMissing: true });
    expect(send).toHaveBeenCalledExactlyOnceWith(
      subscription('ana'),
      expect.objectContaining({ title: 'Última llamada', url: '/' }),
      { ttlSeconds: 3600, urgency: 'high' },
    );
  });

  it('removes each subscription its push service reports as gone, and still sends the rest', async () => {
    const gone = subscription('gone');
    const { sendPushes, store, send } = delivery([gone, subscription('bruno')], {
      [gone.endpoint]: 'gone',
    });

    expect(await sendPushes({ type: 'chapter-published', day: '2026-11-09' })).toEqual({
      ok: true,
      value: { sent: 1, gone: 1, failed: 0 },
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(store.removePushSubscription).toHaveBeenCalledExactlyOnceWith(gone.endpoint);
  });

  it('names who played with the nickname it reads, and nothing else', async () => {
    const { sendPushes, send, store } = delivery([subscription('bruno')]);

    await sendPushes({ type: 'player-played', day: '2026-11-09', characterId: 3 });

    expect(store.nicknameOf).toHaveBeenCalledWith(3);
    expect(send.mock.calls[0]?.[1]).toEqual({
      title: 'La Rata ha movido ficha',
      body: 'Ya ha enviado su acción de hoy. ¿Y tú?',
      url: '/',
      tag: 'played-2026-11-09-La Rata',
    });
  });

  it('reads no keys and sends nothing when nobody should get it', async () => {
    const { sendPushes, readVapidKeys, send } = delivery([]);

    expect(await sendPushes({ type: 'day-opened', day: '2026-11-09' })).toEqual({
      ok: true,
      value: { sent: 0, gone: 0, failed: 0 },
    });
    expect(readVapidKeys).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('fails, so the queue retries it, while the VAPID keys cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sendPushes, send } = delivery(
      [subscription('ana')],
      {},
      {
        ok: false,
        error: { unreadable: ['privateKey'] },
      },
    );

    expect(await sendPushes({ type: 'day-opened', day: '2026-11-09' })).toEqual({
      ok: false,
      error: 'vapid_keys_unreadable',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('fails while the store cannot say who gets it', async () => {
    const { sendPushes, store } = delivery([]);
    store.pushRecipients.mockResolvedValueOnce({ ok: false, error: 'store_unavailable' });

    expect(await sendPushes({ type: 'day-opened', day: '2026-11-09' })).toEqual({
      ok: false,
      error: 'store_unavailable',
    });
  });
});
