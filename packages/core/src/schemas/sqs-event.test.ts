import { describe, expect, it } from 'vitest';

import { sqsEventSchema } from './sqs-event.ts';

describe('sqsEventSchema', () => {
  it('keeps only the id and the body of each record', () => {
    const event = {
      Records: [
        {
          messageId: '059f36b4-87a3-44ab-83d2-661975830a7d',
          receiptHandle: 'AQEBwJnKyrHigUMZj6rYigCgxlaS3SLy0a',
          body: '{"type":"reminder"}',
          attributes: { ApproximateReceiveCount: '1' },
          messageAttributes: {},
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:eu-west-1:111111111111:Notifications',
          awsRegion: 'eu-west-1',
        },
      ],
    };
    expect(sqsEventSchema.parse(event)).toEqual({
      Records: [{ messageId: '059f36b4-87a3-44ab-83d2-661975830a7d', body: '{"type":"reminder"}' }],
    });
  });

  it('rejects an event without records or a record without an id', () => {
    expect(sqsEventSchema.safeParse({}).success).toBe(false);
    expect(sqsEventSchema.safeParse({ Records: [{ body: '{}' }] }).success).toBe(false);
  });
});
