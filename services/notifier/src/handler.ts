import { gameDayOf, type Notification, notificationSchema, sqsEventSchema } from '@cronista/core';
import type { ParametersResult } from '@cronista/parameters';

/** The halves of the VAPID key pair that signs Web Push requests, both read from SSM. */
export type VapidKey = 'privateKey' | 'publicKey';

/** What the notifier handler depends on, so tests can replace it. */
export interface NotifierDependencies {
  readonly readVapidKeys: () => Promise<ParametersResult<VapidKey>>;
}

/** The reply the SQS event source mapping reads with `ReportBatchItemFailures`: what to retry. */
export interface BatchResponse {
  readonly batchItemFailures: readonly { readonly itemIdentifier: string }[];
}

/**
 * Creates the notifier handler, fed by the notifications queue. Sending is not implemented: the
 * handler validates each message, checks that the VAPID keys are readable and logs the game day of
 * each reminder.
 *
 * @remarks
 * A message that is not a notification is reported as failed, so after its retries the queue moves
 * it to the dead-letter queue and the alarm fires. Missing VAPID keys only log a warning until
 * there are push subscriptions to send to.
 */
export function createHandler(
  dependencies: NotifierDependencies,
): (event: unknown) => Promise<BatchResponse> {
  return async (event) => {
    const { Records } = sqsEventSchema.parse(event);

    const failures: { itemIdentifier: string }[] = [];
    const notifications: Notification[] = [];
    for (const record of Records) {
      const notification = parseNotification(record.body);
      if (notification === undefined) {
        // The ID only: a body could carry players' data.
        console.warn({ message: 'invalid notification', messageId: record.messageId });
        failures.push({ itemIdentifier: record.messageId });
      } else {
        notifications.push(notification);
      }
    }

    if (notifications.length > 0) {
      const keys = await dependencies.readVapidKeys();
      if (!keys.ok) {
        console.warn({ message: 'vapid keys unreadable', unreadable: keys.error.unreadable });
      }
    }
    for (const notification of notifications) {
      console.info({
        message: 'reminder not implemented',
        day: gameDayOf(new Date(notification.scheduledTime)),
      });
    }
    return { batchItemFailures: failures };
  };
}

function parseNotification(body: string): Notification | undefined {
  try {
    const parsed = notificationSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
