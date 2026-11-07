/**
 * Lambda without a URL (ADR-23) fed by the notifications queue, where Scheduler leaves the
 * reminders, the checks of the game loop and the hourly check of the public site, and the game leaves
 * the pushes of the day (see {@link createHandler}). It sends Web Push signed with the VAPID pair, and
 * runs the checks here, apart from the `ai-worker` they watch.
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
  PUSH_NOT_DELIVERED_METRIC,
  SITE_CHECK_FAILED_METRIC,
  SITE_METRIC_NAMESPACE,
} from '@cronista/core';
import { createGameStore } from '@cronista/engine';
import { createSiteCheck } from '@cronista/http/site-check';
import { createParameterReader } from '@cronista/parameters';

import { environmentSchema } from './environment.ts';
import { createGameLoopCheck } from './game-loop-check.ts';
import { createHandler } from './handler.ts';
import { createPushSender } from './push-sender.ts';
import { createPushDelivery } from './send-pushes.ts';
import { createSiteWatch } from './site-watch.ts';

// A missing value fails the cold start instead of a batch.
const environment = environmentSchema.parse(process.env);

// The Lambda runtime provides the SDK, and the bundle leaves it out.
const cloudWatch = new CloudWatchClient({});
const sns = new SNSClient({});

const parameterExtension = {
  port: environment.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT,
  sessionToken: environment.AWS_SESSION_TOKEN,
};
const readSecretKey = createParameterReader({
  parameterNames: { supabase: environment.SUPABASE_SECRET_KEY_PARAMETER },
  ...parameterExtension,
});

/** Lambda entry point. */
export const handler = createHandler({
  sendPushes: async (notification) => {
    // Read on each batch, from the extension's cache, so that a rotated key takes over by itself.
    const key = await readSecretKey();
    if (!key.ok) {
      console.warn({ message: 'store key unreadable' });
      return { ok: false, error: 'store_unavailable' };
    }
    const sent = await createPushDelivery({
      store: createGameStore({ url: environment.SUPABASE_URL, secretKey: key.value.supabase }),
      readVapidKeys: createParameterReader({
        parameterNames: {
          privateKey: environment.VAPID_PRIVATE_KEY_PARAMETER,
          publicKey: environment.VAPID_PUBLIC_KEY_PARAMETER,
        },
        ...parameterExtension,
      }),
      pushSender: (keys) => createPushSender({ keys, contact: environment.SITE_URL }),
    })(notification);
    // A refused push is not retried, which would repeat the others: the alarm tells the owner.
    if (sent.ok && sent.value.failed > 0) {
      process.stdout.write(
        embeddedMetricLine(GAME_LOOP_METRIC_NAMESPACE, PUSH_NOT_DELIVERED_METRIC, new Date()),
      );
    }
    return sent;
  },
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
      process.stdout.write(
        embeddedMetricLine(GAME_LOOP_METRIC_NAMESPACE, DEADLINE_CHECKED_METRIC, new Date()),
      );
    },
  }),
  watchSite: createSiteWatch({
    checkSite: createSiteCheck({ siteUrl: environment.SITE_URL }),
    reportFailure: () => {
      process.stdout.write(
        embeddedMetricLine(SITE_METRIC_NAMESPACE, SITE_CHECK_FAILED_METRIC, new Date()),
      );
    },
  }),
});
