import { z } from 'zod';

/**
 * Body of a message in the notifications queue that feeds the `notifier`, which EventBridge
 * Scheduler queues with its scheduled UTC time: the reminders at 19:00 and 21:00, and the checks at
 * 08:30 and 22:30 that the day's `open-day` and `close-day` jobs reported.
 */
export const notificationSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('reminder'),
    scheduledTime: z.iso.datetime(),
  }),
  z.strictObject({
    type: z.literal('game-loop-check'),
    job: z.enum(['open-day', 'close-day']),
    scheduledTime: z.iso.datetime(),
  }),
]);

/** A notification to send, validated by {@link notificationSchema}. */
export type Notification = z.infer<typeof notificationSchema>;

/** A reminder to the players who have not played yet. */
export type Reminder = Extract<Notification, { type: 'reminder' }>;

/** A check that a job of the day reported by its deadline. */
export type GameLoopCheck = Extract<Notification, { type: 'game-loop-check' }>;
