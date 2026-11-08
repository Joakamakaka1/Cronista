import {
  type GameLoopCheck,
  type Notification,
  notificationSchema,
  type PushNotification,
  type Result,
  sqsEventSchema,
} from '@cronista/core';

import type { SendPushesFailure, SendPushesReport } from './send-pushes.ts';

/** What the notifier handler depends on, so tests can replace it. */
export interface NotifierDependencies {
  /** Sends a notification's pushes to whoever should get them now. */
  readonly sendPushes: (
    notification: PushNotification,
  ) => Promise<Result<SendPushesReport, SendPushesFailure>>;
  readonly checkGameLoop: (check: GameLoopCheck) => Promise<void>;
  readonly watchSite: () => Promise<void>;
}

/** The reply the SQS event source mapping reads with `ReportBatchItemFailures`: what to retry. */
export interface BatchResponse {
  readonly batchItemFailures: readonly { readonly itemIdentifier: string }[];
}

/**
 * Creates the notifier handler, fed by the notifications queue. It sends the players' pushes (the
 * reminders, the opening, the chapter published or postponed, and who played), and runs each
 * game-loop check and each check of the public site.
 *
 * @remarks
 * A message that is not a notification, a notification whose pushes could not go out for lack of
 * the store or the VAPID keys, and a game-loop check that fails are reported as failed, so after
 * their retries the queue moves them to the dead-letter queue and the alarm fires. A push that one
 * phone's service refuses is not: retrying the message would repeat the others. A site that fails
 * its check is not either: the watch reports it with its own metric.
 */
export function createHandler(
  dependencies: NotifierDependencies,
): (event: unknown) => Promise<BatchResponse> {
  return async (event) => {
    const { Records } = sqsEventSchema.parse(event);

    // Every message at once: a push service that hangs on one must not push the batch past the
    // Lambda's timeout, or SQS would deliver every message again, pushes already sent included.
    const failed = await Promise.all(Records.map((record) => handleRecord(record, dependencies)));
    const failures = Records.filter((_, index) => failed[index]).map((record) => ({
      itemIdentifier: record.messageId,
    }));
    return { batchItemFailures: failures };
  };
}

/** Handles one message, and answers whether the queue should retry it. */
async function handleRecord(
  record: { readonly messageId: string; readonly body: string },
  dependencies: NotifierDependencies,
): Promise<boolean> {
  const notification = parseNotification(record.body);
  if (notification === undefined) {
    // The ID only: a body could carry players' data.
    console.warn({ message: 'invalid notification', messageId: record.messageId });
    return true;
  }
  if (notification.type === 'site-check') {
    await dependencies.watchSite();
    return false;
  }
  if (notification.type === 'game-loop-check') {
    try {
      await dependencies.checkGameLoop(notification);
      return false;
    } catch (error) {
      console.error({
        message: 'game loop check failed',
        messageId: record.messageId,
        job: notification.job,
        error: error instanceof Error ? error.name : 'unknown',
      });
      return true;
    }
  }
  const sent = await dependencies.sendPushes(notification);
  if (sent.ok) {
    console.info({ message: 'pushes sent', type: notification.type, ...sent.value });
    return false;
  }
  console.error({
    message: 'pushes not sent',
    messageId: record.messageId,
    type: notification.type,
    error: sent.error,
  });
  return true;
}

function parseNotification(body: string): Notification | undefined {
  try {
    const parsed = notificationSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
