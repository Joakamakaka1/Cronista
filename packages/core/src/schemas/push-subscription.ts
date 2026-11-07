import { z } from 'zod';

// The push services of Safari, Chrome and Android browsers, Firefox and Edge. A leading dot also
// accepts any subdomain. The table's check in `packages/db` keeps the same list.
const pushServiceHosts: readonly string[] = [
  'web.push.apple.com',
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  '.notify.windows.com',
];

/** Whether `host` belongs to a push service the notifier is allowed to send to. */
export function isKnownPushService(host: string): boolean {
  return pushServiceHosts.some((known) =>
    known.startsWith('.') ? host.endsWith(known) && host.length > known.length : host === known,
  );
}

const base64Url = (characters: number) =>
  z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${String(characters)}}={0,2}$`));

/**
 * A browser's push subscription: where to send and the keys that encrypt for it (RFC 8291). The app
 * checks it before storing it, and the notifier checks each one it reads, so it never sends to a
 * host that is not a push service.
 */
export const pushSubscriptionSchema = z.strictObject({
  endpoint: z
    .url({ protocol: /^https$/ })
    .max(1024)
    .refine((endpoint) => {
      // Core has no URL global in its types, and the scheme is already checked: the host is what
      // follows it, up to a port, path, query or fragment.
      const host = /^https:\/\/([^/?#:@]+)(?::\d+)?(?:[/?#]|$)/i.exec(endpoint)?.[1];
      return host !== undefined && isKnownPushService(host.toLowerCase());
    }),
  keys: z.strictObject({
    // An uncompressed P-256 point: 65 bytes.
    p256dh: base64Url(87),
    // The authentication secret: 16 bytes.
    auth: base64Url(22),
  }),
});

/** A push subscription, validated by {@link pushSubscriptionSchema}. */
export type PushSubscription = z.infer<typeof pushSubscriptionSchema>;
