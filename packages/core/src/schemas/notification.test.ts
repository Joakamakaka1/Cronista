import { describe, expect, it } from 'vitest';

import { notificationSchema } from './notification.ts';

describe('notificationSchema', () => {
  it('accepts a reminder with its scheduled time', () => {
    const message = { type: 'reminder', scheduledTime: '2026-10-31T18:00:00Z' };
    expect(notificationSchema.parse(message)).toEqual(message);
  });

  it('rejects an unknown type, a missing time and extra fields', () => {
    const scheduledTime = '2026-10-31T18:00:00Z';
    expect(notificationSchema.safeParse({ type: 'chapter', scheduledTime }).success).toBe(false);
    expect(notificationSchema.safeParse({ type: 'reminder' }).success).toBe(false);
    expect(
      notificationSchema.safeParse({ type: 'reminder', scheduledTime, playerId: 'p' }).success,
    ).toBe(false);
  });
});
