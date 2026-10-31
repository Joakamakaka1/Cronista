import {
  GAME_TIME_ZONE,
  OPENING_MINUTE_OF_DAY,
  CLOSING_MINUTE_OF_DAY,
  REMINDER_MINUTES_OF_DAY,
  type Notification,
  type WorkerJob,
} from '@cronista/core';
import { Duration, Stack, type StackProps, TimeZone, Validations } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  MathExpression,
  type IMetric,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import {
  ContextAttribute,
  type IScheduleTarget,
  Schedule,
  ScheduleExpression,
  ScheduleGroup,
  ScheduleTargetInput,
} from 'aws-cdk-lib/aws-scheduler';
import { SqsSendMessage } from 'aws-cdk-lib/aws-scheduler-targets';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

import { aiProviderKeyParameters, vapidKeyParameters } from './config.ts';
import { ServiceFunction } from './service-function.ts';

/** Props of {@link WorkersStack}. */
export interface WorkersStackProps extends StackProps {
  /** The account alerts topic of `AccountGuardsStack`, in this region, for the alarms. */
  readonly alerts: ITopic;
}

// A schedule still undelivered after this goes to the dead-letter queue: a reminder or a close
// that arrives later than an hour would act on a day that has moved on.
const maxScheduleDelay = Duration.hours(1);

// EventBridge Scheduler's default and maximum; the event age above bounds them anyway.
const scheduleRetries = 185;

const notifierTimeout = Duration.seconds(30);

const alarmPeriod = Duration.minutes(5);

// SQS keeps a message for 14 days at most; dead letters wait that long for a look and a redrive.
const deadLetterRetention = Duration.days(14);

/**
 * The game's background Lambdas (ADR-23), with no URL: `ai-worker`, which EventBridge Scheduler
 * runs to open the day at 08:00 and close it at 22:00 (game time), and `notifier`, fed by the
 * notifications queue, where Scheduler also leaves the reminders at 19:00 and 21:00.
 *
 * @remarks
 * Both dead-letter queues and the failures of either Lambda raise an alarm on the account alerts
 * topic.
 */
export class WorkersStack extends Stack {
  constructor(scope: Construct, id: string, props: WorkersStackProps) {
    super(scope, id, props);

    const scheduleGroup = new ScheduleGroup(this, 'Schedules', { scheduleGroupName: 'cronista' });
    const timeZone = TimeZone.of(GAME_TIME_ZONE);
    const dailySchedule = (
      scheduleId: string,
      description: string,
      minuteOfDay: number,
      target: IScheduleTarget,
    ) => {
      const schedule = new Schedule(this, scheduleId, {
        description,
        scheduleGroup,
        schedule: ScheduleExpression.cron({
          hour: String(Math.floor(minuteOfDay / 60)),
          minute: String(minuteOfDay % 60),
          timeZone,
        }),
        target,
      });
      // The group's name is fixed, so the schedule names it without a reference CloudFormation
      // would order by.
      schedule.node.addDependency(scheduleGroup);
    };
    const undeliveredSchedules = new Queue(this, 'UndeliveredSchedules', {
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: deadLetterRetention,
    });
    Validations.of(undeliveredSchedules).acknowledge({
      id: 'AwsSolutions-SQS3',
      reason: "It is the schedules' dead-letter queue, not a queue that anything consumes.",
    });

    // Scheduler assumes these roles only for schedules of this account's group.
    const schedulerRole = (roleId: string, description: string) => {
      const role = new Role(this, roleId, {
        description,
        assumedBy: new ServicePrincipal('scheduler.amazonaws.com', {
          conditions: {
            StringEquals: {
              'aws:SourceAccount': this.account,
              'aws:SourceArn': scheduleGroup.scheduleGroupArn,
            },
          },
        }),
      });
      role.addToPrincipalPolicy(
        new PolicyStatement({
          actions: ['sqs:SendMessage'],
          resources: [undeliveredSchedules.queueArn],
        }),
      );
      return role;
    };

    // -------------------------------------------------------------------------
    // ai-worker
    // -------------------------------------------------------------------------

    // One run at a time: an open or a close never overlaps another one or a manual run.
    const worker = new ServiceFunction(this, 'AiWorker', {
      service: 'ai-worker',
      parameters: {
        ANTHROPIC_API_KEY_PARAMETER: aiProviderKeyParameters.anthropic,
        VOYAGE_API_KEY_PARAMETER: aiProviderKeyParameters.voyage,
        LANGFUSE_SECRET_KEY_PARAMETER: aiProviderKeyParameters.langfuse,
      },
      reservedConcurrency: 1,
      // Lambda's maximum: the close runs autopilot, the narrator and memory extraction.
      timeout: Duration.minutes(15),
    });
    // Scheduler invokes it asynchronously. Retrying is safe because a job is idempotent per
    // (season, day).
    worker.function.configureAsyncInvoke({ retryAttempts: 2, maxEventAge: Duration.hours(1) });

    // Granted by hand: the LambdaInvoke target would also allow every version and alias (`:*`).
    const workerScheduleRole = schedulerRole('WorkerScheduleRole', 'Runs the ai-worker jobs');
    workerScheduleRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [worker.function.functionArn],
      }),
    );
    const workerJobs: readonly [string, WorkerJob['job'], number][] = [
      ['OpenDay', 'open-day', OPENING_MINUTE_OF_DAY],
      ['CloseDay', 'close-day', CLOSING_MINUTE_OF_DAY],
    ];
    for (const [scheduleId, job, minuteOfDay] of workerJobs) {
      dailySchedule(scheduleId, `Runs the ai-worker ${job} job`, minuteOfDay, {
        bind: () => ({
          arn: worker.function.functionArn,
          role: workerScheduleRole,
          input: ScheduleTargetInput.fromObject({
            job,
            scheduledTime: ContextAttribute.scheduledTime,
          }),
          retryPolicy: {
            maximumEventAgeInSeconds: maxScheduleDelay.toSeconds(),
            maximumRetryAttempts: scheduleRetries,
          },
          deadLetterConfig: { arn: undeliveredSchedules.queueArn },
        }),
      });
    }

    // -------------------------------------------------------------------------
    // Notifications queue and notifier
    // -------------------------------------------------------------------------

    const notificationDeadLetters = new Queue(this, 'NotificationDeadLetters', {
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: deadLetterRetention,
    });
    const notifications = new Queue(this, 'Notifications', {
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      // Lambda recommends six times the consumer's timeout, so a retried batch is not received twice.
      visibilityTimeout: Duration.seconds(notifierTimeout.toSeconds() * 6),
      deadLetterQueue: { queue: notificationDeadLetters, maxReceiveCount: 3 },
    });

    const notifier = new ServiceFunction(this, 'Notifier', {
      service: 'notifier',
      parameters: {
        VAPID_PRIVATE_KEY_PARAMETER: vapidKeyParameters.privateKey,
        VAPID_PUBLIC_KEY_PARAMETER: vapidKeyParameters.publicKey,
      },
      // The event source mapping polls with at least two concurrent batches.
      reservedConcurrency: 2,
      timeout: notifierTimeout,
    });
    notifier.function.addEventSource(
      new SqsEventSource(notifications, {
        batchSize: 10,
        reportBatchItemFailures: true,
        maxConcurrency: 2,
      }),
    );

    const reminderScheduleRole = schedulerRole('ReminderScheduleRole', 'Queues the reminders');
    REMINDER_MINUTES_OF_DAY.forEach((minuteOfDay, index) => {
      const reminder: Record<keyof Notification, string> = {
        type: 'reminder',
        scheduledTime: ContextAttribute.scheduledTime,
      };
      dailySchedule(
        `Reminder${index + 1}`,
        'Queues a reminder to the players who have not played',
        minuteOfDay,
        new SqsSendMessage(notifications, {
          role: reminderScheduleRole,
          input: ScheduleTargetInput.fromObject(reminder),
          maxEventAge: maxScheduleDelay,
          retryAttempts: scheduleRetries,
          deadLetterQueue: undeliveredSchedules,
        }),
      );
    });

    // -------------------------------------------------------------------------
    // Alarms
    // -------------------------------------------------------------------------

    // FILL: a metric with no data points would otherwise blank the whole expression.
    const alarmOn = (alarmId: string, description: string, metric: IMetric) => {
      const alarm = new Alarm(this, alarmId, {
        alarmDescription: description,
        metric,
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(new SnsAction(props.alerts));
    };

    alarmOn(
      'AiWorkerFailures',
      'An ai-worker job failed, or was dropped without running.',
      new MathExpression({
        expression: 'FILL(errors, 0) + FILL(dropped, 0)',
        usingMetrics: {
          errors: worker.function.metricErrors({ period: alarmPeriod, statistic: 'Sum' }),
          dropped: worker.function.metric('AsyncEventsDropped', {
            period: alarmPeriod,
            statistic: 'Sum',
          }),
        },
        period: alarmPeriod,
      }),
    );
    alarmOn(
      'NotifierErrors',
      'The notifier failed a batch.',
      notifier.function.metricErrors({ period: alarmPeriod, statistic: 'Sum' }),
    );
    alarmOn(
      'DeadLetters',
      'A notification or a schedule reached a dead-letter queue.',
      new MathExpression({
        expression: 'FILL(notifications, 0) + FILL(schedules, 0)',
        usingMetrics: {
          notifications: notificationDeadLetters.metricApproximateNumberOfMessagesVisible({
            period: alarmPeriod,
            statistic: 'Maximum',
          }),
          schedules: undeliveredSchedules.metricApproximateNumberOfMessagesVisible({
            period: alarmPeriod,
            statistic: 'Maximum',
          }),
        },
        period: alarmPeriod,
      }),
    );
  }
}
