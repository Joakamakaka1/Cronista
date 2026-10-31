import { z } from 'zod';

/**
 * Body of a message in the notifications queue that feeds the `notifier`. Today only the
 * reminders, which EventBridge Scheduler queues at 19:00 and 21:00 with their scheduled UTC time.
 */
export const notificationSchema = z.strictObject({
  type: z.literal('reminder'),
  scheduledTime: z.iso.datetime(),
});

/** A notification to send, validated by {@link notificationSchema}. */
export type Notification = z.infer<typeof notificationSchema>;
