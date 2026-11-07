import { z } from 'zod';

const gameDay = z.iso.date();

/** What the game itself queues for the players: never a nickname or anything a player wrote. */
const gameNotificationSchemas = [
  z.strictObject({ type: z.literal('day-opened'), day: gameDay }),
  z.strictObject({ type: z.literal('chapter-published'), day: gameDay }),
  z.strictObject({ type: z.literal('chapter-postponed'), day: gameDay }),
  // The notifier reads the nickname at send time, so the queue carries only the character's id.
  z.strictObject({
    type: z.literal('player-played'),
    day: gameDay,
    characterId: z.int().positive(),
  }),
] as const;

/**
 * Body of a message in the notifications queue that feeds the `notifier`.
 *
 * @remarks
 * EventBridge Scheduler queues the reminders at 19:00 and 21:00, the checks that the day's
 * `open-day` and `close-day` jobs reported at 08:30 and 22:30, and the check of the public site every
 * hour from 08:00 to 23:00, each with its scheduled UTC time. The game queues the rest: `ai-worker`
 * when a day opens and when a chapter is published or postponed, and `core-api` when a player plays.
 */
export const notificationSchema = z.discriminatedUnion('type', [
  ...gameNotificationSchemas,
  z.strictObject({
    type: z.literal('reminder'),
    scheduledTime: z.iso.datetime(),
  }),
  z.strictObject({
    type: z.literal('game-loop-check'),
    job: z.enum(['open-day', 'close-day']),
    scheduledTime: z.iso.datetime(),
  }),
  z.strictObject({
    type: z.literal('site-check'),
    scheduledTime: z.iso.datetime(),
  }),
]);

/** A notification to send, validated by {@link notificationSchema}. */
export type Notification = z.infer<typeof notificationSchema>;

/** A reminder to the players who have not played yet. */
export type Reminder = Extract<Notification, { type: 'reminder' }>;

/** A notification the game queues for the players, validated by {@link notificationSchema}. */
export type GameNotification = Extract<
  Notification,
  { type: 'day-opened' | 'chapter-published' | 'chapter-postponed' | 'player-played' }
>;

/** A notification that ends in a push to players: the game's own and the scheduled reminders. */
export type PushNotification = GameNotification | Reminder;

/** A check that a job of the day reported by its deadline. */
export type GameLoopCheck = Extract<Notification, { type: 'game-loop-check' }>;
