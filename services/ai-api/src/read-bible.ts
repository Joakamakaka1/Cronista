import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { bibleObjectKey } from '@cronista/core';

/** Creates a reader of a season's bible from the private bucket, or `undefined` when it cannot. */
export function createBibleReader(
  bucket: string,
): (seasonNumber: number) => Promise<string | undefined> {
  const client = new S3Client({});
  return async (seasonNumber) => {
    try {
      const reply = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: bibleObjectKey(seasonNumber) }),
      );
      return await reply.Body?.transformToString('utf-8');
    } catch (error) {
      console.warn({
        message: 'bible not read',
        seasonNumber,
        error: error instanceof Error ? error.name : 'unknown',
      });
      return undefined;
    }
  };
}
