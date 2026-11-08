import { describe, expect, it } from 'vitest';

import { isKnownPushService, pushSubscriptionSchema } from './push-subscription.ts';

const keys = { p256dh: `B${'a'.repeat(86)}`, auth: 'b'.repeat(22) };

describe('pushSubscriptionSchema', () => {
  it.each([
    'https://web.push.apple.com/QGuQyavXutnMH',
    'https://fcm.googleapis.com/fcm/send/dAPT:abc',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://wns2-db5p.notify.windows.com/w/?token=BQYAAA',
  ])('accepts a subscription of a known push service: %s', (endpoint) => {
    expect(pushSubscriptionSchema.parse({ endpoint, keys })).toEqual({ endpoint, keys });
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/x',
    'https://example.com/push',
    'https://fcm.googleapis.com.example.com/x',
    'https://evilweb.push.apple.com/x',
    // A URL parser reads the backslash as a slash, so the host would be evil.example or 127.0.0.1.
    'https://evil.example\\.notify.windows.com/x',
    'https://127.0.0.1\\.notify.windows.com/',
    'https://user@fcm.googleapis.com/x',
    'https://WEB.PUSH.APPLE.COM/x',
    'not a url',
  ])('rejects any other endpoint: %s', (endpoint) => {
    expect(pushSubscriptionSchema.safeParse({ endpoint, keys }).success).toBe(false);
  });

  it('rejects keys of the wrong size or alphabet', () => {
    const endpoint = 'https://web.push.apple.com/x';
    expect(
      pushSubscriptionSchema.safeParse({ endpoint, keys: { ...keys, auth: 'b'.repeat(10) } })
        .success,
    ).toBe(false);
    expect(
      pushSubscriptionSchema.safeParse({ endpoint, keys: { ...keys, p256dh: '+'.repeat(87) } })
        .success,
    ).toBe(false);
  });

  it('accepts the padded base64url some browsers send', () => {
    const endpoint = 'https://web.push.apple.com/x';
    const padded = { p256dh: `${keys.p256dh}=`, auth: `${keys.auth}==` };
    expect(pushSubscriptionSchema.safeParse({ endpoint, keys: padded }).success).toBe(true);
  });
});

describe('isKnownPushService', () => {
  it('matches the host exactly or as a subdomain of a wildcard entry', () => {
    expect(isKnownPushService('web.push.apple.com')).toBe(true);
    expect(isKnownPushService('wns2-db5p.notify.windows.com')).toBe(true);
    expect(isKnownPushService('notify.windows.com.example.com')).toBe(false);
  });
});
