/**
 * Lambda without a URL (ADR-23) that EventBridge Scheduler runs for the day's jobs: the opening at
 * 08:00, the close at 22:00 and the database keep-alive at 04:00 (game time).
 *
 * @packageDocumentation
 */
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import {
  embeddedMetricLine,
  GAME_LOOP_METRIC_NAMESPACE,
  JOB_COMPLETED_METRIC,
  JOB_DIMENSION,
  OWNER_NOT_TOLD_METRIC,
} from '@cronista/core';
import { createParameterReader } from '@cronista/parameters';

import { environmentSchema } from './environment.ts';
import { createGameJobs } from './game-jobs.ts';
import { createHandler } from './handler.ts';
import { createDatabasePing } from './keep-alive.ts';
import { createBibleReader } from './read-bible.ts';

// A missing value fails the cold start instead of a job.
const environment = environmentSchema.parse(process.env);
const parameterExtension = {
  port: environment.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT,
  sessionToken: environment.AWS_SESSION_TOKEN,
};

const readProviderKeys = createParameterReader({
  parameterNames: {
    anthropic: environment.ANTHROPIC_API_KEY_PARAMETER,
    voyage: environment.VOYAGE_API_KEY_PARAMETER,
    langfuse: environment.LANGFUSE_SECRET_KEY_PARAMETER,
    langfusePublic: environment.LANGFUSE_PUBLIC_KEY_PARAMETER,
    supabase: environment.SUPABASE_SECRET_KEY_PARAMETER,
  },
  ...parameterExtension,
});

// The Lambda runtime provides the SDK, and the bundle leaves it out. It gets short limits, because a
// publish that hangs would hold up a job that has already done its work.
const sns = new SNSClient({
  maxAttempts: 2,
  requestHandler: { connectionTimeout: 3000, requestTimeout: 5000 },
});

const jobs = createGameJobs({
  readKeys: readProviderKeys,
  supabaseUrl: environment.SUPABASE_URL,
  langfuseUrl: environment.LANGFUSE_URL,
  readBible: createBibleReader(environment.BIBLE_BUCKET),
  publishAlert: async (subject, message) => {
    await sns.send(
      new PublishCommand({
        TopicArn: environment.ALERTS_TOPIC_ARN,
        Subject: subject,
        Message: message,
      }),
    );
  },
  reportOwnerNotTold: () => {
    process.stdout.write(
      embeddedMetricLine(GAME_LOOP_METRIC_NAMESPACE, OWNER_NOT_TOLD_METRIC, new Date()),
    );
  },
});

/** Lambda entry point. */
export const handler = createHandler({
  readProviderKeys,
  pingDatabase: createDatabasePing({
    supabaseUrl: environment.SUPABASE_URL,
    readSecretKey: createParameterReader({
      parameterNames: { supabase: environment.SUPABASE_SECRET_KEY_PARAMETER },
      ...parameterExtension,
    }),
  }),
  openDay: jobs.openDay,
  closeDay: jobs.closeDay,
  checkSpend: jobs.checkSpend,
  flushTraces: jobs.flushTraces,
  reportJobCompleted: (job) => {
    process.stdout.write(
      embeddedMetricLine(GAME_LOOP_METRIC_NAMESPACE, JOB_COMPLETED_METRIC, new Date(), {
        [JOB_DIMENSION]: job,
      }),
    );
  },
});
