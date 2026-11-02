import type { Stack } from 'aws-cdk-lib';
import { type ITopic, Topic } from 'aws-cdk-lib/aws-sns';

/** Name of the topic of every account alert. Fixed, so that no stack needs a reference to it. */
export const alertsTopicName = 'cronista-alerts';

/**
 * The alerts topic of `CronistaAlerts`, for a stack in its region.
 *
 * @remarks
 * By name, because a reference would make that owner-only stack an upstream of the stacks CI deploys,
 * and CI's `cdk deploy` would then try to deploy it too.
 */
export const alertsTopicIn = (stack: Stack): ITopic =>
  Topic.fromTopicArn(
    stack,
    'AlertsTopic',
    stack.formatArn({ service: 'sns', resource: alertsTopicName }),
  );
