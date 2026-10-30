import { describe, expect, it } from 'vitest';

import { parameterStoreReplySchema } from './parameter-store.ts';

describe('parameterStoreReplySchema', () => {
  it('reads the value out of the extension reply', () => {
    const reply = {
      Parameter: {
        ARN: 'arn:aws:ssm:eu-west-1:111111111111:parameter/cronista/prod/voyage/api-key',
        Name: '/cronista/prod/voyage/api-key',
        Type: 'SecureString',
        Value: 'invented-value',
        Version: 1,
      },
      ResultMetadata: {},
    };
    expect(parameterStoreReplySchema.parse(reply)).toEqual({
      Parameter: { Value: 'invented-value' },
    });
  });

  it('rejects a reply without a value or with an empty one', () => {
    expect(parameterStoreReplySchema.safeParse({ Parameter: {} }).success).toBe(false);
    expect(parameterStoreReplySchema.safeParse({ Parameter: { Value: '' } }).success).toBe(false);
    expect(parameterStoreReplySchema.safeParse({}).success).toBe(false);
  });
});
