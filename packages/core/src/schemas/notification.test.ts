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

  it('accepts a site check with its scheduled time and nothing else', () => {
    const message = { type: 'site-check', scheduledTime };
    expect(notificationSchema.parse(message)).toEqual(message);
    expect(notificationSchema.safeParse({ ...message, url: 'https://x' }).success).toBe(false);
  });

  it('rejects an unknown type, a missing time and extra fields', () => {
    expect(notificationSchema.safeParse({ type: 'chapter', scheduledTime }).success).toBe(false);
    expect(notificationSchema.safeParse({ type: 'reminder' }).success).toBe(false);
    expect(
      notificationSchema.safeParse({ type: 'reminder', scheduledTime, playerId: 'p' }).success,
    ).toBe(false);
  });

  it.each(['day-opened', 'chapter-published', 'chapter-postponed'])(
    'accepts a %s message with its game day and nothing else',
    (type) => {
      const message = { type, day: '2026-11-09' };
      expect(notificationSchema.parse(message)).toEqual(message);
      expect(notificationSchema.safeParse({ ...message, text: 'x' }).success).toBe(false);
      expect(notificationSchema.safeParse({ type, day: '9/11/2026' }).success).toBe(false);
    },
  );

  it('accepts who played by character id, never by nickname or text', () => {
    const message = { type: 'player-played', day: '2026-11-09', characterId: 3 };
    expect(notificationSchema.parse(message)).toEqual(message);
    expect(notificationSchema.safeParse({ ...message, nickname: 'Rata' }).success).toBe(false);
    expect(notificationSchema.safeParse({ ...message, characterId: 0 }).success).toBe(false);
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
