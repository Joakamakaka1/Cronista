import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { AccountGuardsStack } from './account-guards-stack.ts';
import { nagFindings } from './nag-findings.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

let guardsStack: AccountGuardsStack;
let guards: Template;

beforeAll(() => {
  const app = new App({ context: cdkConfig.context });
  guardsStack = new AccountGuardsStack(app, 'Guards', { env: { account, region: 'eu-west-1' } });
  guards = Template.fromStack(guardsStack);
});

describe('AccountGuardsStack', () => {
  it('lets only Budgets and Cost Anomaly Detection of this account publish alerts', () => {
    guards.hasResourceProperties('AWS::SNS::TopicPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 'sns:Publish',
            Principal: { Service: ['budgets.amazonaws.com', 'costalerts.amazonaws.com'] },
            Condition: { StringEquals: { 'aws:SourceAccount': account } },
          }),
        ]),
      }),
    });
  });

  it("lets only this account's Cronista alarms publish through CloudWatch", () => {
    guards.hasResourceProperties('AWS::SNS::TopicPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 'sns:Publish',
            Principal: { Service: 'cloudwatch.amazonaws.com' },
            Condition: {
              StringEquals: { 'aws:SourceAccount': account },
              ArnLike: {
                'aws:SourceArn': {
                  'Fn::Join': [
                    '',
                    [
                      'arn:',
                      { Ref: 'AWS::Partition' },
                      `:cloudwatch:eu-west-1:${account}:alarm:Cronista*`,
                    ],
                  ],
                },
              },
            },
          }),
        ]),
      }),
    });
  });

  it('sends active Access Analyzer findings of any region to the topic', () => {
    const [topicId] = Object.keys(guards.findResources('AWS::SNS::Topic'));
    guards.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.access-analyzer'],
        'detail-type': ['Access Analyzer Finding'],
        account: [account],
        detail: { status: ['ACTIVE'], isDeleted: [false] },
      },
      Targets: [Match.objectLike({ Arn: { Ref: topicId } })],
    });
  });

  it('lets EventBridge publish alerts only from the findings rule', () => {
    const [ruleId] = Object.keys(guards.findResources('AWS::Events::Rule'));
    guards.hasResourceProperties('AWS::SNS::TopicPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 'sns:Publish',
            Principal: { Service: 'events.amazonaws.com' },
            Condition: { ArnEquals: { 'aws:SourceArn': { 'Fn::GetAtt': [ruleId, 'Arn'] } } },
          }),
        ]),
      }),
    });
  });

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
    expect(template).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  });

  it('creates the topic policy before any alert that publishes to the topic', () => {
    const [policyId] = Object.keys(guards.findResources('AWS::SNS::TopicPolicy'));
    for (const type of ['AWS::Budgets::Budget', 'AWS::CE::AnomalySubscription']) {
      for (const alert of Object.values(guards.findResources(type))) {
        expect(alert.DependsOn).toContain(policyId);
      }
    }
  });

  it('reports cost anomalies of 1 USD or more immediately through the topic', () => {
    guards.hasResourceProperties('AWS::CE::AnomalyMonitor', {
      MonitorType: 'DIMENSIONAL',
      MonitorDimension: 'SERVICE',
    });
    guards.hasResourceProperties('AWS::CE::AnomalySubscription', {
      Frequency: 'IMMEDIATE',
      Subscribers: [Match.objectLike({ Type: 'SNS' })],
      ThresholdExpression: JSON.stringify({
        Dimensions: {
          Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE',
          MatchOptions: ['GREATER_THAN_OR_EQUAL'],
          Values: ['1'],
        },
      }),
    });
  });

  it('records management events in every region with file validation', () => {
    guards.resourceCountIs('AWS::CloudTrail::Trail', 1);
    guards.hasResourceProperties('AWS::CloudTrail::Trail', {
      IsMultiRegionTrail: true,
      IncludeGlobalServiceEvents: true,
      EnableLogFileValidation: true,
    });
  });

  it('refuses trail writes that come from another account', () => {
    guards.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Principal: { Service: 'cloudtrail.amazonaws.com' },
            Action: ['s3:GetBucketAcl', 's3:PutObject'],
            Condition: { StringNotEquals: { 'aws:SourceAccount': account } },
          }),
        ]),
      }),
    });
  });

  it('keeps the trail logs private for 90 days', () => {
    guards.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      LifecycleConfiguration: {
        Rules: [Match.objectLike({ ExpirationInDays: 90, Status: 'Enabled' })],
      },
    });
  });

  it('passes the AWS Solutions checks', () => {
    expect(nagFindings(guardsStack)).toEqual([]);
  });
});
