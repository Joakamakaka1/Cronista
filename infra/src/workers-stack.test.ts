import { environmentSchema as aiWorkerEnvironment } from '@cronista/ai-worker/environment';
import { notificationSchema, workerJobSchema } from '@cronista/core';
import { environmentSchema as notifierEnvironment } from '@cronista/notifier/environment';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { AccountGuardsStack } from './account-guards-stack.ts';
import { nagFindings } from './nag-findings.ts';
import { WorkersStack } from './workers-stack.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

let workersStack: WorkersStack;
let workers: Template;

beforeAll(() => {
  // Same context as the real app, so the tests synthesize what gets deployed.
  const app = new App({ context: cdkConfig.context });
  const guardsStack = new AccountGuardsStack(app, 'Guards', {
    env: { account, region: 'eu-west-1' },
  });
  workersStack = new WorkersStack(app, 'Workers', {
    env: { account, region: 'eu-west-1' },
    alerts: guardsStack.alerts,
  });
  workers = Template.fromStack(workersStack);
});

// -----------------------------------------------------------------------------
// Template helpers
// -----------------------------------------------------------------------------

interface Resource {
  readonly Type: string;
  readonly Properties?: Record<string, unknown>;
  readonly DependsOn?: string[];
}

function resources(type: string): [string, Resource][] {
  return Object.entries(workers.findResources(type) as Record<string, Resource>);
}

function only(type: string, matches: (resource: Resource) => boolean): [string, Resource] {
  const found = resources(type).filter(([, resource]) => matches(resource));
  if (found.length !== 1 || found[0] === undefined) {
    throw new Error(`Expected one ${type}, found ${found.length}.`);
  }
  return found[0];
}

const includes = (resource: Resource, text: string) =>
  JSON.stringify(resource.Properties).includes(text);

// The functions are told apart by the parameters they read.
function functionOf(service: 'ai-worker' | 'notifier'): [string, Resource] {
  const marker = service === 'ai-worker' ? 'ANTHROPIC_API_KEY_PARAMETER' : 'VAPID_';
  return only('AWS::Lambda::Function', (fn) => includes(fn, marker));
}

function roleIdOf(service: 'ai-worker' | 'notifier'): string {
  const role = JSON.stringify(functionOf(service)[1].Properties?.Role);
  const match = /"Fn::GetAtt":\["([^"]+)","Arn"\]/.exec(role);
  if (match?.[1] === undefined) throw new Error(`No role for ${service}.`);
  return match[1];
}

function statementsOf(roleId: string): Record<string, unknown>[] {
  return resources('AWS::IAM::Policy')
    .filter(([, policy]) => JSON.stringify(policy.Properties?.Roles).includes(`"${roleId}"`))
    .flatMap(([, policy]) => {
      const document = policy.Properties?.PolicyDocument as {
        Statement: Record<string, unknown>[];
      };
      return document.Statement;
    });
}

// The queues are told apart by their role: the one with a redrive policy, its dead-letter queue
// and the dead-letter queue of the schedules.
function queueIds() {
  const queues = resources('AWS::SQS::Queue');
  const [notifications] = queues.find(([, queue]) => queue.Properties?.RedrivePolicy) ?? [''];
  const redrive = JSON.stringify(
    queues.find(([id]) => id === notifications)?.[1].Properties?.RedrivePolicy,
  );
  const [deadLetters] = queues.find(([id]) => redrive.includes(`"${id}"`)) ?? [''];
  const [undelivered] = queues.find(([id]) => id !== notifications && id !== deadLetters) ?? [''];
  return { notifications, deadLetters, undelivered };
}

const ssmArn = (name: string) => ({
  'Fn::Join': [
    '',
    ['arn:', { Ref: 'AWS::Partition' }, `:ssm:eu-west-1:${account}:parameter${name}`],
  ],
});

interface ScheduleTarget {
  readonly Arn: unknown;
  readonly RoleArn: unknown;
  readonly Input: string;
  readonly RetryPolicy: unknown;
  readonly DeadLetterConfig: unknown;
}

function scheduleAt(expression: string): Record<string, unknown> & { Target: ScheduleTarget } {
  const [, schedule] = only(
    'AWS::Scheduler::Schedule',
    (resource) => resource.Properties?.ScheduleExpression === expression,
  );
  return schedule.Properties as Record<string, unknown> & { Target: ScheduleTarget };
}

// What Scheduler sends once it replaces the context attribute with the scheduled time.
function deliveredInput(target: ScheduleTarget): unknown {
  return JSON.parse(target.Input.replace('<aws.scheduler.scheduled-time>', '2026-10-31T21:00:00Z'));
}

// -----------------------------------------------------------------------------
// Lambdas
// -----------------------------------------------------------------------------

describe('WorkersStack', () => {
  describe('Lambdas', () => {
    it.each([
      ['ai-worker', 1, 900],
      ['notifier', 2, 30],
    ] as const)(
      'runs %s on Node 24 arm64 with reserved concurrency %i and a %i s timeout',
      (service, concurrency, timeout) => {
        expect(functionOf(service)[1].Properties).toMatchObject({
          Runtime: 'nodejs24.x',
          Architectures: ['arm64'],
          ReservedConcurrentExecutions: concurrency,
          Timeout: timeout,
          LoggingConfig: { LogFormat: 'JSON' },
        });
      },
    );

    it('gives neither a Function URL nor a resource policy: only their triggers run them', () => {
      workers.resourceCountIs('AWS::Lambda::Url', 0);
      workers.resourceCountIs('AWS::Lambda::Permission', 0);
    });

    it('retries a failed ai-worker job twice, and drops it after an hour', () => {
      const [workerId] = functionOf('ai-worker');
      workers.hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
        FunctionName: { Ref: workerId },
        Qualifier: '$LATEST',
        MaximumRetryAttempts: 2,
        MaximumEventAgeInSeconds: 3600,
      });
    });

    it('lets ai-worker read exactly its three provider keys, and nothing else in SSM', () => {
      const ssm = statementsOf(roleIdOf('ai-worker')).filter((statement) =>
        JSON.stringify(statement).includes('ssm:'),
      );
      expect(ssm).toEqual([
        {
          Effect: 'Allow',
          Action: 'ssm:GetParameter',
          Resource: [
            '/cronista/prod/anthropic/game-api-key',
            '/cronista/prod/voyage/api-key',
            '/cronista/prod/langfuse/secret-key',
          ].map(ssmArn),
        },
      ]);
    });

    it('lets notifier read exactly the VAPID key pair, and nothing else in SSM', () => {
      const ssm = statementsOf(roleIdOf('notifier')).filter((statement) =>
        JSON.stringify(statement).includes('ssm:'),
      );
      expect(ssm).toEqual([
        {
          Effect: 'Allow',
          Action: 'ssm:GetParameter',
          Resource: ['/cronista/prod/vapid/private-key', '/cronista/prod/vapid/public-key'].map(
            ssmArn,
          ),
        },
      ]);
    });

    it('gives ai-worker no access to the notifications queue yet', () => {
      expect(JSON.stringify(statementsOf(roleIdOf('ai-worker')))).not.toContain('sqs:');
    });

    it.each([
      ['ai-worker', aiWorkerEnvironment],
      ['notifier', notifierEnvironment],
    ] as const)('gives %s every variable its handler parses at cold start', (service, schema) => {
      const { Variables } = functionOf(service)[1].Properties?.Environment as {
        Variables: Record<string, unknown>;
      };
      // The Lambda runtime adds the session token; everything else comes from the stack.
      const parsed = schema.safeParse({ ...Variables, AWS_SESSION_TOKEN: 'set-by-the-runtime' });
      expect(parsed.error?.issues).toBeUndefined();
    });

    it('keeps their logs for two weeks', () => {
      const logGroups = resources('AWS::Logs::LogGroup');
      expect(logGroups).toHaveLength(2);
      for (const [, logGroup] of logGroups) expect(logGroup.Properties?.RetentionInDays).toBe(14);
    });
  });

  // ---------------------------------------------------------------------------
  // Schedules
  // ---------------------------------------------------------------------------

  describe('schedules', () => {
    it.each([
      ['cron(0 8 * * ? *)', 'open-day'],
      ['cron(0 22 * * ? *)', 'close-day'],
    ])('runs ai-worker at %s Madrid time to %s', (expression, job) => {
      const schedule = scheduleAt(expression);
      expect(schedule.ScheduleExpressionTimezone).toBe('Europe/Madrid');
      expect(schedule.Target.Arn).toEqual({ 'Fn::GetAtt': [functionOf('ai-worker')[0], 'Arn'] });
      expect(workerJobSchema.parse(deliveredInput(schedule.Target))).toEqual({
        job,
        scheduledTime: '2026-10-31T21:00:00Z',
      });
    });

    it.each(['cron(0 19 * * ? *)', 'cron(0 21 * * ? *)'])(
      'queues a reminder at %s Madrid time',
      (expression) => {
        const schedule = scheduleAt(expression);
        expect(schedule.ScheduleExpressionTimezone).toBe('Europe/Madrid');
        expect(schedule.Target.Arn).toEqual({
          'Fn::GetAtt': [queueIds().notifications, 'Arn'],
        });
        expect(notificationSchema.parse(deliveredInput(schedule.Target))).toEqual({
          type: 'reminder',
          scheduledTime: '2026-10-31T21:00:00Z',
        });
      },
    );

    it('fires every schedule on time, in its own group, within an hour or to the dead-letter queue', () => {
      const [[groupId, group] = ['', { Type: '' }]] = resources('AWS::Scheduler::ScheduleGroup');
      expect(group.Properties?.Name).toBe('cronista');
      const schedules = resources('AWS::Scheduler::Schedule');
      expect(schedules).toHaveLength(4);
      for (const [, schedule] of schedules) {
        expect(schedule.Properties).toMatchObject({
          FlexibleTimeWindow: { Mode: 'OFF' },
          State: 'ENABLED',
          GroupName: 'cronista',
          Target: {
            RetryPolicy: { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 185 },
            DeadLetterConfig: { Arn: { 'Fn::GetAtt': [queueIds().undelivered, 'Arn'] } },
          },
        });
        // A name is no reference: without it, CloudFormation could create the schedule first.
        expect(schedule.DependsOn).toContain(groupId);
      }
    });

    it('lets each schedule role do only its own delivery, and only for schedules of its group', () => {
      const [[groupId] = ['']] = resources('AWS::Scheduler::ScheduleGroup');
      const roleIdOfTarget = (expression: string) => {
        const match = /"Fn::GetAtt":\["([^"]+)","Arn"\]/.exec(
          JSON.stringify(scheduleAt(expression).Target.RoleArn),
        );
        return match?.[1] ?? '';
      };
      const workerRole = roleIdOfTarget('cron(0 22 * * ? *)');
      const reminderRole = roleIdOfTarget('cron(0 19 * * ? *)');
      expect(roleIdOfTarget('cron(0 8 * * ? *)')).toBe(workerRole);
      expect(roleIdOfTarget('cron(0 21 * * ? *)')).toBe(reminderRole);
      expect(workerRole).not.toBe(reminderRole);

      const { notifications, undelivered } = queueIds();
      const sendTo = (queue: string) => ({
        Effect: 'Allow',
        Action: 'sqs:SendMessage',
        Resource: { 'Fn::GetAtt': [queue, 'Arn'] },
      });
      const invokeWorker = {
        Effect: 'Allow',
        Action: 'lambda:InvokeFunction',
        Resource: { 'Fn::GetAtt': [functionOf('ai-worker')[0], 'Arn'] },
      };
      const sameStatements = (actual: unknown[], expected: unknown[]) => {
        expect(actual).toHaveLength(expected.length);
        expect(actual).toEqual(expect.arrayContaining(expected));
      };
      sameStatements(statementsOf(workerRole), [invokeWorker, sendTo(undelivered)]);
      sameStatements(statementsOf(reminderRole), [sendTo(notifications), sendTo(undelivered)]);

      for (const roleId of [workerRole, reminderRole]) {
        const trust = resources('AWS::IAM::Role').find(([id]) => id === roleId)?.[1].Properties
          ?.AssumeRolePolicyDocument;
        expect(trust).toEqual({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'sts:AssumeRole',
              Principal: { Service: 'scheduler.amazonaws.com' },
              Condition: {
                StringEquals: {
                  'aws:SourceAccount': account,
                  'aws:SourceArn': { 'Fn::GetAtt': [groupId, 'Arn'] },
                },
              },
            },
          ],
        });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Queues
  // ---------------------------------------------------------------------------

  describe('queues', () => {
    it('moves a notification to the dead-letter queue after three failed receives', () => {
      const { notifications, deadLetters } = queueIds();
      const [, queue] = only('AWS::SQS::Queue', (resource) =>
        Boolean(resource.Properties?.RedrivePolicy),
      );
      expect(notifications).not.toBe('');
      expect(queue.Properties).toMatchObject({
        RedrivePolicy: {
          deadLetterTargetArn: { 'Fn::GetAtt': [deadLetters, 'Arn'] },
          maxReceiveCount: 3,
        },
        // Six times the notifier's timeout, as Lambda recommends for an SQS event source.
        VisibilityTimeout: 180,
      });
    });

    it('keeps dead letters for the 14 days SQS allows', () => {
      const { deadLetters, undelivered } = queueIds();
      for (const id of [deadLetters, undelivered]) {
        expect(
          resources('AWS::SQS::Queue').find(([queueId]) => queueId === id)?.[1].Properties,
        ).toMatchObject({ MessageRetentionPeriod: 1209600 });
      }
    });

    it('encrypts every queue and refuses requests without TLS', () => {
      const queues = resources('AWS::SQS::Queue');
      expect(queues).toHaveLength(3);
      for (const [, queue] of queues) expect(queue.Properties?.SqsManagedSseEnabled).toBe(true);
      const policies = resources('AWS::SQS::QueuePolicy');
      expect(policies).toHaveLength(3);
      for (const [, policy] of policies) {
        expect(JSON.stringify(policy.Properties?.PolicyDocument)).toContain(
          '{"Bool":{"aws:SecureTransport":"false"}}',
        );
      }
    });

    it('feeds the notifier from the queue, two batches at a time, retrying only what failed', () => {
      workers.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        FunctionName: { Ref: functionOf('notifier')[0] },
        EventSourceArn: { 'Fn::GetAtt': [queueIds().notifications, 'Arn'] },
        BatchSize: 10,
        FunctionResponseTypes: ['ReportBatchItemFailures'],
        ScalingConfig: { MaximumConcurrency: 2 },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Alarms and guards
  // ---------------------------------------------------------------------------

  describe('alarms', () => {
    const alarms = () => resources('AWS::CloudWatch::Alarm');

    it('raises four alarms, each on the first occurrence, to the account alerts topic', () => {
      expect(alarms()).toHaveLength(4);
      const actions = alarms().map(([, alarm]) => JSON.stringify(alarm.Properties?.AlarmActions));
      expect(new Set(actions).size).toBe(1);
      expect(actions[0]).toContain('CostAlerts');
      for (const [, alarm] of alarms()) {
        expect(alarm.Properties).toMatchObject({
          ComparisonOperator: 'GreaterThanOrEqualToThreshold',
          Threshold: 1,
          EvaluationPeriods: 1,
          TreatMissingData: 'notBreaching',
        });
      }
    });

    it('alarms when an ai-worker job fails or is dropped without running', () => {
      const [workerId] = functionOf('ai-worker');
      const [, alarm] = only('AWS::CloudWatch::Alarm', (resource) =>
        includes(resource, 'AsyncEventsDropped'),
      );
      const metrics = JSON.stringify(alarm.Properties?.Metrics);
      expect(metrics).toContain('"MetricName":"Errors"');
      expect(metrics).toContain(`{"Name":"FunctionName","Value":{"Ref":"${workerId}"}}`);
      expect(metrics).toContain('FILL(');
    });

    it('alarms when the notifier fails', () => {
      const [notifierId] = functionOf('notifier');
      only(
        'AWS::CloudWatch::Alarm',
        (resource) =>
          includes(resource, '"MetricName":"Errors"') &&
          includes(resource, `{"Ref":"${notifierId}"}`),
      );
    });

    it('alarms while a dead notification waits in its dead-letter queue', () => {
      const [, alarm] = only('AWS::CloudWatch::Alarm', (resource) =>
        includes(resource, 'ApproximateNumberOfMessagesVisible'),
      );
      expect(alarm.Properties).toMatchObject({
        Statistic: 'Maximum',
        Dimensions: [
          { Name: 'QueueName', Value: { 'Fn::GetAtt': [queueIds().deadLetters, 'QueueName'] } },
        ],
      });
    });

    it('alarms on every undelivered schedule, even with older ones still queued', () => {
      // A count of visible messages would stay in alarm, and so silent, after the first one.
      const [, alarm] = only('AWS::CloudWatch::Alarm', (resource) =>
        includes(resource, 'NumberOfMessagesSent'),
      );
      expect(alarm.Properties).toMatchObject({
        Statistic: 'Sum',
        Dimensions: [
          { Name: 'QueueName', Value: { 'Fn::GetAtt': [queueIds().undelivered, 'QueueName'] } },
        ],
      });
    });
  });

  it('bounds every role with the CDK execution policy and attaches no managed policy', () => {
    const roles = resources('AWS::IAM::Role');
    expect(roles).toHaveLength(4);
    for (const [, role] of roles) {
      expect(role.Properties?.PermissionsBoundary).toEqual({
        'Fn::Join': [
          '',
          ['arn:', { Ref: 'AWS::Partition' }, `:iam::${account}:policy/cronista-cfn-execution`],
        ],
      });
      expect(role.Properties?.ManagedPolicyArns).toBeUndefined();
    }
  });

  it('passes the AWS Solutions checks', () => {
    expect(nagFindings(workersStack)).toEqual([]);
  });
});
