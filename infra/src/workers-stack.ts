import {
  CLOSING_DEADLINE_MINUTE_OF_DAY,
  CLOSING_MINUTE_OF_DAY,
  DEADLINE_CHECKED_METRIC,
  GAME_LOOP_METRIC_NAMESPACE,
  GAME_TIME_ZONE,
  type GameLoopCheck,
  type Notification,
  OPENING_DEADLINE_MINUTE_OF_DAY,
  OPENING_MINUTE_OF_DAY,
  type Reminder,
  REMINDER_MINUTES_OF_DAY,
  type WorkerJob,
} from '@cronista/core';
import { Duration, Stack, type StackProps, TimeZone, Validations } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  MathExpression,
  Metric,
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
import { SnsPublish, SqsSendMessage } from 'aws-cdk-lib/aws-scheduler-targets';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

import { alarmOnAny, alarmPeriod } from './alarm.ts';
import {
  aiProviderKeyParameters,
  supabaseSecretKeyParameter,
  supabaseUrl,
  vapidKeyParameters,
} from './config.ts';
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

// Game time, when nobody plays and no other job runs. Supabase says a few queries a day usually
// keep the Free plan from pausing the project after a quiet week; it does not promise it.
const keepAliveMinuteOfDay = 4 * 60;

// SQS keeps a message for 14 days at most; dead letters wait that long for a look and a redrive.
const deadLetterRetention = Duration.days(14);

// Longer than the longest wait between two checks of the game loop, 14 hours from 08:30 to 22:30.
// The clock changes fall in the shorter wait, from 22:30 to 08:30.
const checksMissingHours = 15;

/**
 * The game's background Lambdas (ADR-23), with no URL: `ai-worker`, which EventBridge Scheduler
 * runs to open the day at 08:00, close it at 22:00 and keep the database awake at 04:00 (game
 * time), and `notifier`, fed by the notifications queue, where Scheduler also leaves the reminders
 * at 19:00 and 21:00 and the checks at 08:30 and 22:30 that the day opened and closed.
 *
 * @remarks
 * Both dead-letter queues and the failures of either Lambda raise an alarm on the account alerts
 * topic. The checks are not a CloudWatch alarm because a metric that reports once a day fits none:
 * a sliding window reaches 24 hours at most under a period of one hour, so it would fire each day
 * until that day's report landed, and clock changes make the gap 23 or 25 hours; a wall clock window
 * aligns to whole hours or midnight, never to 08:30. The checks run on `notifier` so that a broken
 * or busy `ai-worker` cannot silence them, and an alarm watches that they keep running.
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
        SUPABASE_SECRET_KEY_PARAMETER: supabaseSecretKeyParameter,
      },
      environment: { SUPABASE_URL: supabaseUrl },
      reservedConcurrency: 1,
      // Lambda's maximum, sized for the close, the longest job of the day.
      timeout: Duration.minutes(15),
    });
    // Scheduler invokes it asynchronously. The retries rely on the rule that a job is idempotent
    // per (season, day) (`infra.md`): running it again never publishes twice.
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
      ['KeepAlive', 'keep-alive', keepAliveMinuteOfDay],
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
      environment: { ALERTS_TOPIC_ARN: props.alerts.topicArn },
      parameters: {
        VAPID_PRIVATE_KEY_PARAMETER: vapidKeyParameters.privateKey,
        VAPID_PUBLIC_KEY_PARAMETER: vapidKeyParameters.publicKey,
      },
      // The event source mapping polls with at least two concurrent batches.
      reservedConcurrency: 2,
      timeout: notifierTimeout,
    });
    props.alerts.grantPublish(notifier.function);
    notifier.function.addToRolePolicy(
      new PolicyStatement({
        actions: ['cloudwatch:GetMetricStatistics'],
        resources: ['*'],
      }),
    );
    Validations.of(notifier).acknowledge({
      id: 'AwsSolutions-IAM5[Resource::*]',
      reason:
        'CloudWatch does not scope GetMetricStatistics to a resource; it only reads metric values.',
    });
    notifier.function.addEventSource(
      new SqsEventSource(notifications, {
        batchSize: 10,
        reportBatchItemFailures: true,
        maxConcurrency: 2,
      }),
    );

    const notificationScheduleRole = schedulerRole(
      'ReminderScheduleRole',
      'Queues the reminders and the checks of the game loop',
    );
    const queueNotification = (notification: Notification) =>
      new SqsSendMessage(notifications, {
        role: notificationScheduleRole,
        input: ScheduleTargetInput.fromObject(notification),
        maxEventAge: maxScheduleDelay,
        retryAttempts: scheduleRetries,
        deadLetterQueue: undeliveredSchedules,
      });
    REMINDER_MINUTES_OF_DAY.forEach((minuteOfDay, index) => {
      const reminder: Reminder = {
        type: 'reminder',
        scheduledTime: ContextAttribute.scheduledTime,
      };
      dailySchedule(
        `Reminder${index + 1}`,
        'Queues a reminder to the players who have not played',
        minuteOfDay,
        queueNotification(reminder),
      );
    });

    const gameLoopChecks: readonly [string, GameLoopCheck['job'], number][] = [
      ['CheckOpening', 'open-day', OPENING_DEADLINE_MINUTE_OF_DAY],
      ['CheckClosing', 'close-day', CLOSING_DEADLINE_MINUTE_OF_DAY],
    ];
    for (const [scheduleId, job, minuteOfDay] of gameLoopChecks) {
      const check: GameLoopCheck = {
        type: 'game-loop-check',
        job,
        scheduledTime: ContextAttribute.scheduledTime,
      };
      dailySchedule(
        scheduleId,
        `Queues the check that the ${job} job reported by its deadline`,
        minuteOfDay,
        queueNotification(check),
      );
    }

    // -------------------------------------------------------------------------
    // Yearly maintenance
    // -------------------------------------------------------------------------

    // A Supabase token renewed after this reminder, with the longest expiry, outlasts the next one.
    new Schedule(this, 'YearlyMaintenanceReminder', {
      description: 'Reminds the owner of the yearly maintenance',
      scheduleGroup,
      schedule: ScheduleExpression.cron({
        month: '10',
        day: '1',
        hour: '10',
        minute: '0',
        timeZone,
      }),
      target: new SnsPublish(props.alerts, {
        role: schedulerRole('MaintenanceReminderRole', 'Sends the yearly maintenance reminder'),
        input: ScheduleTargetInput.fromText(
          [
            'Cronista: yearly maintenance',
            '',
            '1. Renew SUPABASE_ACCESS_TOKEN and SUPABASE_MIGRATIONS_TOKEN before they expire.',
            '2. Rotate the API keys in SSM. The VAPID pair is never rotated.',
            '3. Run the manual restore drill of the backups.',
            '',
            'The steps are in "Renewing the Supabase tokens", "Rotating secrets" and "Backups and the restore drill" in docs/development.md.',
          ].join('\n'),
        ),
        maxEventAge: maxScheduleDelay,
        retryAttempts: scheduleRetries,
        deadLetterQueue: undeliveredSchedules,
      }),
    }).node.addDependency(scheduleGroup);

    // -------------------------------------------------------------------------
    // Alarms
    // -------------------------------------------------------------------------

    const alarmOn = (alarmId: string, description: string, metric: IMetric) => {
      alarmOnAny(this, alarmId, description, metric, props.alerts);
    };

    alarmOn(
      'AiWorkerFailures',
      'An ai-worker job failed, or was dropped without running.',
      new MathExpression({
        // FILL: a metric with no data points would otherwise blank the whole expression.
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
    // SQS does not count what its redrive policy moves in NumberOfMessagesSent, so this alarm watches
    // the waiting messages. It clears when they are gone, or once SQS stops sending the metrics of a
    // queue nothing has touched for six hours.
    alarmOn(
      'NotificationDeadLettersAlarm',
      'A notification reached its dead-letter queue.',
      notificationDeadLetters.metricApproximateNumberOfMessagesVisible({
        period: alarmPeriod,
        statistic: 'Maximum',
      }),
    );
    // Scheduler sends its dead letters, so each new one counts, even with older ones still queued: a
    // job that never ran raises no ai-worker alarm.
    alarmOn(
      'UndeliveredSchedulesAlarm',
      'Scheduler could not deliver a job, a reminder or a check within an hour.',
      undeliveredSchedules.metricNumberOfMessagesSent({ period: alarmPeriod, statistic: 'Sum' }),
    );
    // Missing data breaches here: silence is the failure this alarm exists to catch. Its first state
    // is ALARM, until the first check after the deploy reports.
    new Alarm(this, 'GameLoopCheckMissing', {
      alarmDescription:
        `No check of the game loop has run for ${checksMissingHours} hours, so nothing would tell if ` +
        'the day failed to open or close.',
      metric: new Metric({
        namespace: GAME_LOOP_METRIC_NAMESPACE,
        metricName: DEADLINE_CHECKED_METRIC,
        period: Duration.hours(1),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: checksMissingHours,
      datapointsToAlarm: checksMissingHours,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.BREACHING,
    }).addAlarmAction(new SnsAction(props.alerts));
  }
}
