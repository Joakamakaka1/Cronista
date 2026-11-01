/**
 * Lambda without a URL (ADR-23) fed by the notifications queue, where Scheduler leaves the
 * reminders and the checks of the game loop. It runs those checks here, apart from the `ai-worker`
 * they watch. Sending with Web Push (VAPID) is a stub (see {@link createHandler}).
 *
 * @packageDocumentation
 */
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import {
  DEADLINE_CHECKED_METRIC,
  embeddedMetricLine,
  GAME_LOOP_METRIC_NAMESPACE,
  JOB_COMPLETED_METRIC,
  JOB_DIMENSION,
} from '@cronista/core';
import { createParameterReader } from '@cronista/parameters';

import { environmentSchema } from './environment.ts';
import { createGameLoopCheck } from './game-loop-check.ts';
import { createHandler } from './handler.ts';

// A missing value fails the cold start instead of a batch.
const environment = environmentSchema.parse(process.env);

// The Lambda runtime provides the SDK, and the bundle leaves it out.
const cloudWatch = new CloudWatchClient({});
const sns = new SNSClient({});

/** Lambda entry point. */
export const handler = createHandler({
  readVapidKeys: createParameterReader({
    parameterNames: {
      privateKey: environment.VAPID_PRIVATE_KEY_PARAMETER,
      publicKey: environment.VAPID_PUBLIC_KEY_PARAMETER,
    },
    port: environment.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT,
    sessionToken: environment.AWS_SESSION_TOKEN,
  }),
  checkGameLoop: createGameLoopCheck({
    countCompletions: async (job, from, to) => {
      const { Datapoints = [] } = await cloudWatch.send(
        new GetMetricStatisticsCommand({
          Namespace: GAME_LOOP_METRIC_NAMESPACE,
          MetricName: JOB_COMPLETED_METRIC,
          Dimensions: [{ Name: JOB_DIMENSION, Value: job }],
          StartTime: from,
          EndTime: to,
          Period: 60,
          Statistics: ['Sum'],
        }),
      );
      return Datapoints.reduce((total, datapoint) => total + (datapoint.Sum ?? 0), 0);
    },
    publishAlert: async (subject, message) => {
      await sns.send(
        new PublishCommand({
          TopicArn: environment.ALERTS_TOPIC_ARN,
          Subject: subject,
          Message: message,
        }),
      );
    },
    reportChecked: () => {
      process.stdout.write(embeddedMetricLine(DEADLINE_CHECKED_METRIC, new Date()));
    },
  }),
});
