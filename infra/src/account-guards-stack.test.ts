import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { AccountGuardsStack } from './account-guards-stack.ts';
import { nagFindings } from './nag-findings.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

const alertsTopicArn = {
  'Fn::Join': [
    '',
    ['arn:', { Ref: 'AWS::Partition' }, `:sns:eu-west-1:${account}:cronista-alerts`],
  ],
};

let guardsStack: AccountGuardsStack;
let guards: Template;

beforeAll(() => {
  const app = new App({ context: cdkConfig.context });
  guardsStack = new AccountGuardsStack(app, 'Guards', { env: { account, region: 'eu-west-1' } });
  guards = Template.fromStack(guardsStack);
});

describe('AccountGuardsStack', () => {
  it.each([5, 10])('alerts on a monthly cost budget of %d USD', (amount) => {
    guards.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({
        BudgetType: 'COST',
        TimeUnit: 'MONTHLY',
        BudgetLimit: { Amount: amount, Unit: 'USD' },
      }),
      NotificationsWithSubscribers: [
        Match.objectLike({
          Notification: Match.objectLike({ NotificationType: 'ACTUAL', Threshold: 80 }),
        }),
        Match.objectLike({
          Notification: Match.objectLike({ NotificationType: 'ACTUAL', Threshold: 100 }),
        }),
        Match.objectLike({
          Notification: Match.objectLike({ NotificationType: 'FORECASTED', Threshold: 100 }),
        }),
      ],
    });
  });

  it('sends every budget alert to the topic, never to an email in the code', () => {
    const template = JSON.stringify(guards.toJSON());
    for (const resource of Object.values(guards.findResources('AWS::Budgets::Budget'))) {
      expect(JSON.stringify(resource)).not.toContain('"SubscriptionType":"EMAIL"');
    }
    guards.hasResourceProperties('AWS::Budgets::Budget', {
      NotificationsWithSubscribers: Match.arrayWith([
        Match.objectLike({
          Subscribers: [{ SubscriptionType: 'SNS', Address: alertsTopicArn }],
        }),
      ]),
    });
    expect(template).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  });

  it('reports cost anomalies of 1 USD or more immediately through the topic', () => {
    guards.hasResourceProperties('AWS::CE::AnomalyMonitor', {
      MonitorType: 'DIMENSIONAL',
      MonitorDimension: 'SERVICE',
    });
    guards.hasResourceProperties('AWS::CE::AnomalySubscription', {
      Frequency: 'IMMEDIATE',
      Subscribers: [{ Type: 'SNS', Address: alertsTopicArn }],
      ThresholdExpression: JSON.stringify({
        Dimensions: {
          Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE',
          MatchOptions: ['GREATER_THAN_OR_EQUAL'],
          Values: ['1'],
        },
      }),
    });
  });

  it.each([
    'AWS::SNS::Topic',
    'AWS::SNS::TopicPolicy',
    'AWS::Events::Rule',
    'AWS::CloudTrail::Trail',
    'AWS::S3::Bucket',
    'AWS::S3::BucketPolicy',
  ])('leaves the %s to the owner-only stacks', (type) => {
    guards.resourceCountIs(type, 0);
  });

  it('alerts when any Lambda of the region is throttled, with one billed alarm metric', () => {
    guards.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/Lambda',
      MetricName: 'Throttles',
      Dimensions: Match.absent(),
      Statistic: 'Sum',
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'notBreaching',
      AlarmActions: [alertsTopicArn],
    });
  });

  it('passes the AWS Solutions checks', () => {
    expect(nagFindings(guardsStack)).toEqual([]);
  });
});
