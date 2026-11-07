import {
  CLOSING_MINUTE_OF_DAY,
  gameMinuteOfDay,
  playerPlayedMessage,
  type PushMessage,
  type PushNotification,
  pushMessage,
  type Result,
} from '@cronista/core';
import { type GameStore, pushRecipients } from '@cronista/engine';
import type { ParametersResult } from '@cronista/parameters';

import type { PushDelivery, PushOutcome, SendPush, VapidKeys } from './push-sender.ts';

/** Why a notification's pushes did not go out: the queue retries it, and then dead-letters it. */
export type SendPushesFailure = 'store_unavailable' | 'vapid_keys_unreadable';

/** How many pushes each outcome had. */
export type SendPushesReport = Readonly<Record<PushOutcome, number>>;

/** What {@link createPushDelivery} needs. */
export interface PushDeliveryDependencies {
  readonly store: Pick<GameStore, 'pushRecipients' | 'removePushSubscription' | 'nicknameOf'>;
  readonly readVapidKeys: () => Promise<ParametersResult<keyof VapidKeys>>;
  /** Creates the sender once the keys are read. */
  readonly pushSender: (keys: VapidKeys) => SendPush;
}

/**
 * Creates what sends a notification's pushes: it asks the store who gets it at send time, so a
 * player who has just played gets no reminder, and removes each subscription its push service
 * reports as gone. One push that fails never stops the others, and is not tried again: a retry of
 * the message would repeat the pushes that went out.
 */
export function createPushDelivery(
  dependencies: PushDeliveryDependencies,
): (notification: PushNotification) => Promise<Result<SendPushesReport, SendPushesFailure>> {
  const { store } = dependencies;
  return async (notification) => {
    const report = { sent: 0, gone: 0, failed: 0 };
    const recipients = await pushRecipients(store, notification);
    if (!recipients.ok) return recipients;
    if (recipients.value.length === 0) return { ok: true, value: report };

    let message: PushMessage;
    if (notification.type === 'player-played') {
      const nickname = await store.nicknameOf(notification.characterId);
      if (!nickname.ok) return nickname;
      if (nickname.value === undefined) return { ok: true, value: report };
      message = playerPlayedMessage(notification.day, nickname.value);
    } else {
      message = pushMessage(notification);
    }

    const keys = await dependencies.readVapidKeys();
    if (!keys.ok) {
      console.warn({ message: 'vapid keys unreadable', unreadable: keys.error.unreadable });
      return { ok: false, error: 'vapid_keys_unreadable' };
    }
    const send = dependencies.pushSender(keys.value);
    const delivery = deliveryOf(notification);

    const outcomes = await Promise.all(
      recipients.value.map(async (subscription) => {
        const outcome = await send(subscription, message, delivery);
        if (outcome === 'gone') {
          const removed = await store.removePushSubscription(subscription.endpoint);
          if (!removed.ok) console.warn({ message: 'gone subscription kept' });
        }
        return outcome;
      }),
    );
    for (const outcome of outcomes) report[outcome] += 1;
    return { ok: true, value: report };
  };
}

// A push is worth delivering only while it still means something: an opening or a reminder until
// the close, who played for an hour, a chapter until the next morning.
function deliveryOf(notification: PushNotification): PushDelivery {
  switch (notification.type) {
    case 'reminder': {
      const minutesLeft =
        CLOSING_MINUTE_OF_DAY - gameMinuteOfDay(new Date(notification.scheduledTime));
      return { ttlSeconds: Math.max(minutesLeft, 1) * 60, urgency: 'high' };
    }
    case 'day-opened':
      return { ttlSeconds: 14 * 60 * 60, urgency: 'normal' };
    case 'player-played':
      return { ttlSeconds: 60 * 60, urgency: 'low' };
    case 'chapter-published':
    case 'chapter-postponed':
      return { ttlSeconds: 12 * 60 * 60, urgency: 'normal' };
  }
}
