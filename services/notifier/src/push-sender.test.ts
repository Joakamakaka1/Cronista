import { generateKeyPairSync } from 'node:crypto';

import type { PushSubscription } from '@cronista/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPushSender, type VapidKeys } from './push-sender.ts';

/** A P-256 pair as base64url: the private scalar and the uncompressed public point. */
function p256Pair(): { readonly privateKey: string; readonly publicKey: string } {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
    format: 'jwk',
  });
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x ?? '', 'base64url'),
    Buffer.from(jwk.y ?? '', 'base64url'),
  ]);
  return { privateKey: jwk.d ?? '', publicKey: point.toString('base64url') };
}

const vapid: VapidKeys = p256Pair();
const subscription: PushSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/invented-browser',
  keys: {
    p256dh: p256Pair().publicKey,
    auth: Buffer.from('sixteen byte key').toString('base64url'),
  },
};
const message = { title: 'Edición de hoy', body: 'Texto.', url: '/', tag: 'day-2026-11-09' };
const delivery = { ttlSeconds: 3600, urgency: 'high' } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPushSender', () => {
  it('posts an encrypted, VAPID-signed push to the subscription', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response(null, { status: 201 })),
    );
    const send = createPushSender({ keys: vapid, contact: 'https://example.com', fetch });

    expect(await send(subscription, message, delivery)).toBe('sent');

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(subscription.endpoint);
    const headers = new Headers(init?.headers);
    expect(headers.get('content-encoding')).toBe('aes128gcm');
    expect(headers.get('ttl')).toBe('3600');
    expect(headers.get('urgency')).toBe('high');
    expect(headers.get('authorization')).toMatch(new RegExp(`^vapid t=.+, k=${vapid.publicKey}$`));
    // Encrypted: the title never travels in clear.
    const body = Buffer.from(init?.body instanceof Uint8Array ? init.body : []).toString('utf8');
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toContain('Edición');
  });

  it.each([404, 410])(
    'reports a subscription its service answers %i to as gone',
    async (status) => {
      const fetch = () => Promise.resolve(new Response(null, { status }));
      const send = createPushSender({ keys: vapid, contact: 'https://example.com', fetch });
      expect(await send(subscription, message, delivery)).toBe('gone');
    },
  );

  it('reports any other refusal as failed, logging the host and never the endpoint', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetch = () => Promise.resolve(new Response(null, { status: 429 }));
    const send = createPushSender({ keys: vapid, contact: 'https://example.com', fetch });

    expect(await send(subscription, message, delivery)).toBe('failed');
    expect(warn).toHaveBeenCalledExactlyOnceWith({
      message: 'push refused',
      status: 429,
      host: 'fcm.googleapis.com',
    });
  });

  it('never throws when the push service cannot be reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetch = () => Promise.reject(new TypeError('network'));
    const send = createPushSender({ keys: vapid, contact: 'https://example.com', fetch });
    expect(await send(subscription, message, delivery)).toBe('failed');
  });
});
