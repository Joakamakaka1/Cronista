import { describe, expect, it, vi } from 'vitest';

import { createQueueNotifier, pushRecipients } from './notifications.ts';

describe('createQueueNotifier', () => {
  it('queues the notification as its JSON body', async () => {
    const send = vi.fn(() => Promise.resolve());
    const notify = createQueueNotifier(send);
    expect(await notify({ type: 'day-opened', day: '2026-11-09' })).toBe(true);
    expect(send).toHaveBeenCalledWith('{"type":"day-opened","day":"2026-11-09"}');
  });

  it('answers false and never throws when the queue fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const notify = createQueueNotifier(() => Promise.reject(new Error('queue down')));
    await expect(notify({ type: 'chapter-published', day: '2026-11-09' })).resolves.toBe(false);
  });

  it('answers false for a notification its schema refuses, and sends nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const send = vi.fn(() => Promise.resolve());
    const notify = createQueueNotifier(send);
    expect(await notify({ type: 'player-played', day: '2026-11-09', characterId: 0 })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('pushRecipients', () => {
  const store = () => ({
    pushRecipients: vi.fn(() => Promise.resolve({ ok: true as const, value: [] })),
  });

  it('asks a reminder for the players missing on its game day', async () => {
    const fake = store();
    await pushRecipients(fake, { type: 'reminder', scheduledTime: '2026-11-09T20:00:00Z' });
    expect(fake.pushRecipients).toHaveBeenCalledWith({ day: '2026-11-09', onlyMissing: true });
  });

  it('leaves out the player who played', async () => {
    const fake = store();
    await pushRecipients(fake, { type: 'player-played', day: '2026-11-09', characterId: 4 });
    expect(fake.pushRecipients).toHaveBeenCalledWith({
      day: '2026-11-09',
      onlyMissing: false,
      exceptCharacterId: 4,
    });
  });

  it.each(['day-opened', 'chapter-published', 'chapter-postponed'] as const)(
    'sends %s to every player',
    async (type) => {
      const fake = store();
      await pushRecipients(fake, { type, day: '2026-11-09' });
      expect(fake.pushRecipients).toHaveBeenCalledWith({ day: '2026-11-09', onlyMissing: false });
    },
  );
});
