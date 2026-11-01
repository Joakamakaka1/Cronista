import { describe, expect, it } from 'vitest';

import { notificationSchema } from './notification.ts';

const scheduledTime = '2026-10-31T18:00:00Z';

describe('notificationSchema', () => {
  it('accepts a reminder with its scheduled time', () => {
    const message = { type: 'reminder', scheduledTime };
    expect(notificationSchema.parse(message)).toEqual(message);
  });

  it.each(['open-day', 'close-day'])('accepts a game-loop check of %s', (job) => {
    const message = { type: 'game-loop-check', job, scheduledTime };
    expect(notificationSchema.parse(message)).toEqual(message);
  });

  it('rejects an unknown type, a missing time and extra fields', () => {
    expect(notificationSchema.safeParse({ type: 'chapter', scheduledTime }).success).toBe(false);
    expect(notificationSchema.safeParse({ type: 'reminder' }).success).toBe(false);
    expect(
      notificationSchema.safeParse({ type: 'reminder', scheduledTime, playerId: 'p' }).success,
    ).toBe(false);
  });

  it('rejects a check of a job without a deadline, and one without a job', () => {
    expect(
      notificationSchema.safeParse({ type: 'game-loop-check', job: 'keep-alive', scheduledTime })
        .success,
    ).toBe(false);
    expect(notificationSchema.safeParse({ type: 'game-loop-check', scheduledTime }).success).toBe(
      false,
    );
  });
});
