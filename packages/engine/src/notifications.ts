import {
  gameDayOf,
  type GameNotification,
  notificationSchema,
  type PushNotification,
  type PushSubscription,
} from '@cronista/core';

import type { GameStore, StoreResult } from './store.ts';

/**
 * Queues a push for the players, and answers whether it was queued. It never throws: a failure to
 * queue never fails an action or a job, which have already done their work.
 */
export type Notify = (notification: GameNotification) => Promise<boolean>;

/**
 * Creates a {@link Notify} over a queue: `send` takes the message body. Whatever `send` throws, and a
 * notification its schema refuses, is logged and answered with `false`.
 */
export function createQueueNotifier(send: (body: string) => Promise<void>): Notify {
  return async (notification) => {
    try {
      await send(JSON.stringify(notificationSchema.parse(notification)));
      return true;
    } catch (error) {
      console.error({
        message: 'notification not queued',
        type: notification.type,
        day: notification.day,
        error: error instanceof Error ? error.name : 'unknown',
      });
      return false;
    }
  };
}

/**
 * Who gets the push of `notification`, read when it is sent: a reminder only reaches the players who
 * have not played yet while the day is open, "who played" everyone but that player, and the rest
 * every player of the active season.
 */
export function pushRecipients(
  store: Pick<GameStore, 'pushRecipients'>,
  notification: PushNotification,
): Promise<StoreResult<readonly PushSubscription[]>> {
  switch (notification.type) {
    case 'reminder':
      return store.pushRecipients({
        day: gameDayOf(new Date(notification.scheduledTime)),
        onlyMissing: true,
      });
    case 'player-played':
      return store.pushRecipients({
        day: notification.day,
        onlyMissing: false,
        exceptCharacterId: notification.characterId,
      });
    default:
      return store.pushRecipients({ day: notification.day, onlyMissing: false });
  }
}
