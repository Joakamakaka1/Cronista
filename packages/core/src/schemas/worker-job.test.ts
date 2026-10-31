import { describe, expect, it } from 'vitest';

import { workerJobSchema } from './worker-job.ts';

describe('workerJobSchema', () => {
  it.each(['open-day', 'close-day'])('accepts the %s job with its scheduled time', (job) => {
    const input = { job, scheduledTime: '2026-10-31T21:00:00Z' };
    expect(workerJobSchema.parse(input)).toEqual(input);
  });

  it('rejects an unknown job, a missing time and a time with an offset', () => {
    const scheduledTime = '2026-10-31T21:00:00Z';
    expect(workerJobSchema.safeParse({ job: 'publish', scheduledTime }).success).toBe(false);
    expect(workerJobSchema.safeParse({ job: 'close-day' }).success).toBe(false);
    expect(
      workerJobSchema.safeParse({ job: 'close-day', scheduledTime: '2026-10-31T22:00:00+01:00' })
        .success,
    ).toBe(false);
  });

  it('rejects extra fields, so a hand-made invocation cannot carry anything else', () => {
    const input = { job: 'close-day', scheduledTime: '2026-10-31T21:00:00Z', season: 2 };
    expect(workerJobSchema.safeParse(input).success).toBe(false);
  });
});
