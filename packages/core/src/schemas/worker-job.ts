import { z } from 'zod';

/**
 * What EventBridge Scheduler sends the `ai-worker`: the job (open the day at 08:00, close it at
 * 22:00, keep the database awake at 04:00) and the UTC time it was scheduled for, which names the
 * game day even on a late retry.
 */
export const workerJobSchema = z.strictObject({
  job: z.enum(['open-day', 'close-day', 'keep-alive']),
  scheduledTime: z.iso.datetime(),
});

/** A job for the `ai-worker`, validated by {@link workerJobSchema}. */
export type WorkerJob = z.infer<typeof workerJobSchema>;
