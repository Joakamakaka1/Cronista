import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { AlertsStack } from './alerts-stack.ts';
import { nagFindings } from './nag-findings.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

const ruleArn = (name: string) => ({
  'Fn::Join': [
    '',
    ['arn:', { Ref: 'AWS::Partition' }, `:events:eu-west-1:${account}:rule/${name}`],
  ],
});

let alertsStack: AlertsStack;
let alerts: Template;

beforeAll(() => {
  const app = new App({ context: cdkConfig.context });
  alertsStack = new AlertsStack(app, 'Alerts', { env: { account, region: 'eu-west-1' } });
  alerts = Template.fromStack(alertsStack);
});

describe('AlertsStack', () => {
  it('names the topic, so that every stack reaches it without a reference', () => {
    alerts.resourceCountIs('AWS::SNS::Topic', 1);
    alerts.hasResourceProperties('AWS::SNS::Topic', { TopicName: 'cronista-alerts' });
  });

  it('keeps the topic and the email subscription made by hand if the stack goes away', () => {
    alerts.hasResource('AWS::SNS::Topic', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  it('refuses anything published without TLS', () => {
    alerts.hasResourceProperties('AWS::SNS::TopicPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: 'sns:Publish',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      }),
    });
  });

  it('lets only Budgets and Cost Anomaly Detection of this account publish alerts', () => {
    alerts.hasResourceProperties('AWS::SNS::TopicPolicy', {
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
    alerts.hasResourceProperties('AWS::SNS::TopicPolicy', {
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

  it('lets EventBridge publish alerts only from the Access Analyzer and GuardDuty rules', () => {
    alerts.hasResourceProperties('AWS::SNS::TopicPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 'sns:Publish',
            Principal: { Service: 'events.amazonaws.com' },
            Condition: {
              ArnEquals: {
                'aws:SourceArn': [
                  ruleArn('cronista-access-analyzer-findings'),
                  ruleArn('cronista-guardduty-findings'),
                ],
              },
            },
          }),
        ]),
      }),
    });
  });

  it('never writes an email into the template', () => {
    expect(JSON.stringify(alerts.toJSON())).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  });

  it('passes the AWS Solutions checks', () => {
    expect(nagFindings(alertsStack)).toEqual([]);
  });
});
