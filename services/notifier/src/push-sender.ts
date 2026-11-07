import type { PushMessage, PushSubscription } from '@cronista/core';
import webPush from 'web-push';

/** The VAPID pair as SSM keeps it: the private scalar and the uncompressed public point, base64url. */
export interface VapidKeys {
  readonly privateKey: string;
  readonly publicKey: string;
}

/** How the push service answered one push. `gone` means the subscription no longer exists. */
export type PushOutcome = 'sent' | 'gone' | 'failed';

/** How long the push service keeps a push for a phone that is offline, and how hard it tries. */
export interface PushDelivery {
  readonly ttlSeconds: number;
  readonly urgency: 'low' | 'normal' | 'high';
}

/** Sends one push to one subscription. It never throws. */
export type SendPush = (
  subscription: PushSubscription,
  message: PushMessage,
  delivery: PushDelivery,
) => Promise<PushOutcome>;

/** What {@link createPushSender} needs. */
export interface PushSenderOptions {
  readonly keys: VapidKeys;
  /** Who the push services can contact about these pushes: the site's `https` URL. */
  readonly contact: string;
  /** Replaces the global `fetch` in tests. */
  readonly fetch?: typeof fetch;
}

// Short against the notifier's 60 s timeout, which a whole batch shares.
const requestTimeoutMs = 10_000;

/**
 * Creates a Web Push sender: `web-push` encrypts each message for its subscription with
 * `aes128gcm` (RFC 8291), the encoding Apple requires, and signs it with the VAPID pair (RFC 8292).
 * The request goes out with `fetch`, under a timeout of its own.
 */
export function createPushSender(options: PushSenderOptions): SendPush {
  const send = options.fetch ?? fetch;
  const vapidDetails = {
    subject: options.contact,
    publicKey: options.keys.publicKey,
    privateKey: options.keys.privateKey,
  };
  return async (subscription, message, { ttlSeconds, urgency }) => {
    try {
      const request = webPush.generateRequestDetails(
        { endpoint: subscription.endpoint, keys: { ...subscription.keys } },
        JSON.stringify(message),
        { vapidDetails, TTL: ttlSeconds, urgency, contentEncoding: 'aes128gcm' },
      );
      const response = await send(request.endpoint, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (response.ok) return 'sent';
      // RFC 8030: the subscription expired or the browser unsubscribed.
      if (response.status === 404 || response.status === 410) return 'gone';
      console.warn({
        message: 'push refused',
        status: response.status,
        host: hostOf(subscription),
      });
      return 'failed';
    } catch (error) {
      console.warn({
        message: 'push not sent',
        host: hostOf(subscription),
        error: error instanceof Error ? error.name : 'unknown',
      });
      return 'failed';
    }
  };
}

// The endpoint's path identifies a browser, so logs carry the push service's host only.
const hostOf = ({ endpoint }: PushSubscription) => new URL(endpoint).host;
