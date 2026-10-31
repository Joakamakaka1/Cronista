import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { beforeAll, describe, expect, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { nagFindings } from './nag-findings.ts';
import { ThreatDetectionStack } from './threat-detection-stack.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

const alertsRegion = 'eu-west-1';

const findingsPattern = {
  source: ['aws.guardduty'],
  'detail-type': ['GuardDuty Finding'],
  account: [account],
  detail: { severity: [{ numeric: ['>=', 4] }] },
};

const alertsBusArn = {
  'Fn::Join': [
    '',
    ['arn:', { Ref: 'AWS::Partition' }, `:events:${alertsRegion}:${account}:event-bus/default`],
  ],
};

let alertsRegionStack: ThreatDetectionStack;
let forwardingStack: ThreatDetectionStack;
let alertsRegionDetection: Template;
let forwardingDetection: Template;

beforeAll(() => {
  // One app per region: synthesizing an app freezes it.
  const alertsApp = new App({ context: cdkConfig.context });
  const env = { account, region: alertsRegion };
  const alerts = new Topic(new Stack(alertsApp, 'Guards', { env }), 'CostAlerts');
  alertsRegionStack = new ThreatDetectionStack(alertsApp, 'Detection', {
    env,
    alertsRegion,
    alerts,
  });
  forwardingStack = new ThreatDetectionStack(new App({ context: cdkConfig.context }), 'Detection', {
    env: { account, region: 'us-east-1' },
    alertsRegion,
  });
  alertsRegionDetection = Template.fromStack(alertsRegionStack);
  forwardingDetection = Template.fromStack(forwardingStack);
});

describe('ThreatDetectionStack', () => {
  it('deploys with the CLI credentials, never through the CloudFormation execution role', () => {
    for (const detection of [alertsRegionDetection, forwardingDetection]) {
      expect(detection.toJSON()).not.toHaveProperty('Parameters.BootstrapVersion');
    }
  });

  it('keeps the one detector a region allows, enabled and retained', () => {
    for (const detection of [alertsRegionDetection, forwardingDetection]) {
      detection.resourceCountIs('AWS::GuardDuty::Detector', 1);
      detection.hasResource('AWS::GuardDuty::Detector', {
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
        Properties: Match.objectLike({
          Enable: true,
          FindingPublishingFrequency: 'SIX_HOURS',
          Tags: [{ Key: 'Project', Value: 'la-cronica' }],
        }),
      });
    }
  });

  it('keeps the logical ID that the import of the hand-made detector maps', () => {
    expect(Object.keys(alertsRegionDetection.findResources('AWS::GuardDuty::Detector'))).toEqual([
      'Detector',
    ]);
  });

  it('turns on the protections that cost nothing without matching resources', () => {
    alertsRegionDetection.hasResourceProperties('AWS::GuardDuty::Detector', {
      Features: Match.arrayWith(
        [
          'S3_DATA_EVENTS',
          'EKS_AUDIT_LOGS',
          'EBS_MALWARE_PROTECTION',
          'RDS_LOGIN_EVENTS',
          'LAMBDA_NETWORK_LOGS',
        ].map((name) => ({ Name: name, Status: 'ENABLED' })),
      ),
    });
    alertsRegionDetection.hasResourceProperties('AWS::GuardDuty::Detector', {
      Features: Match.arrayWith([{ Name: 'RUNTIME_MONITORING', Status: 'DISABLED' }]),
    });
  });

  it('sends medium and higher findings of any region to the alerts topic', () => {
    alertsRegionDetection.hasResourceProperties('AWS::Events::Rule', {
      Name: 'cronista-guardduty-findings',
      EventPattern: findingsPattern,
      Targets: [Match.objectLike({ Arn: { 'Fn::GetStackOutput': Match.anyValue() } })],
    });
    alertsRegionDetection.resourceCountIs('AWS::IAM::Role', 0);
  });

  it('forwards medium and higher findings to the default event bus of the alerts region', () => {
    forwardingDetection.hasResourceProperties('AWS::Events::Rule', {
      Name: 'cronista-guardduty-findings',
      EventPattern: findingsPattern,
      Targets: [Match.objectLike({ Arn: alertsBusArn, RoleArn: Match.anyValue() })],
    });
  });

  it('lets the named forwarding role only put events on that bus, for this account', () => {
    forwardingDetection.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'cronista-guardduty-forwarder',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { Service: 'events.amazonaws.com' },
            Condition: { StringEquals: { 'aws:SourceAccount': account } },
          }),
        ],
      },
      PermissionsBoundary: {
        'Fn::Join': [
          '',
          ['arn:', { Ref: 'AWS::Partition' }, `:iam::${account}:policy/cronista-cfn-execution`],
        ],
      },
    });
    forwardingDetection.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [{ Effect: 'Allow', Action: 'events:PutEvents', Resource: alertsBusArn }],
      },
    });
  });

  it('refuses the alerts region without a topic to publish to', () => {
    expect(
      () =>
        new ThreatDetectionStack(new App({ context: cdkConfig.context }), 'Detection', {
          env: { account, region: alertsRegion },
          alertsRegion,
        }),
    ).toThrow(/alerts topic/);
  });

  it('passes the AWS Solutions checks in the alerts region and in the forwarding one', () => {
    expect(nagFindings(alertsRegionStack)).toEqual([]);
    expect(nagFindings(forwardingStack)).toEqual([]);
  });
});
