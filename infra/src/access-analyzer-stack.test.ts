import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { AccessAnalyzerStack } from './access-analyzer-stack.ts';
import { nagFindings } from './nag-findings.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

const alertsRegion = 'eu-west-1';

const alertsTopicArn = {
  'Fn::Join': [
    '',
    ['arn:', { Ref: 'AWS::Partition' }, `:sns:eu-west-1:${account}:cronista-alerts`],
  ],
};

const alertsBusArn = {
  'Fn::Join': [
    '',
    ['arn:', { Ref: 'AWS::Partition' }, `:events:${alertsRegion}:${account}:event-bus/default`],
  ],
};

let alertsRegionStack: AccessAnalyzerStack;
let forwardingStack: AccessAnalyzerStack;
let alertsRegionAnalyzer: Template;
let forwardingAnalyzer: Template;

beforeAll(() => {
  // One app per stack: synthesizing an app freezes it.
  const analyzerIn = (region: string): AccessAnalyzerStack =>
    new AccessAnalyzerStack(new App({ context: cdkConfig.context }), 'Analyzer', {
      env: { account, region },
      alertsRegion,
    });
  alertsRegionStack = analyzerIn(alertsRegion);
  forwardingStack = analyzerIn('us-east-1');
  alertsRegionAnalyzer = Template.fromStack(alertsRegionStack);
  forwardingAnalyzer = Template.fromStack(forwardingStack);
});

describe('AccessAnalyzerStack', () => {
  it('deploys with the CLI credentials, never through the CloudFormation execution role', () => {
    for (const analyzer of [alertsRegionAnalyzer, forwardingAnalyzer]) {
      expect(analyzer.toJSON()).not.toHaveProperty('Parameters.BootstrapVersion');
    }
  });

  it('keeps the one account analyzer a region allows, retained', () => {
    for (const analyzer of [alertsRegionAnalyzer, forwardingAnalyzer]) {
      analyzer.resourceCountIs('AWS::AccessAnalyzer::Analyzer', 1);
      analyzer.hasResource('AWS::AccessAnalyzer::Analyzer', {
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
        Properties: Match.objectLike({ Type: 'ACCOUNT' }),
      });
    }
  });

  it('forwards active findings to the default event bus of the alerts region', () => {
    forwardingAnalyzer.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.access-analyzer'],
        'detail-type': ['Access Analyzer Finding'],
        account: [account],
        detail: { status: ['ACTIVE'], isDeleted: [false] },
      },
      Targets: [
        Match.objectLike({
          Arn: alertsBusArn,
          RoleArn: Match.anyValue(),
        }),
      ],
    });
  });

  it('names the forwarding rule and role, so the execution policy can deny them', () => {
    forwardingAnalyzer.hasResourceProperties('AWS::Events::Rule', {
      Name: 'cronista-access-analyzer-findings',
    });
    forwardingAnalyzer.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'cronista-access-analyzer-forwarder',
    });
  });

  it('lets the forwarding role only put events on that bus, for this account', () => {
    forwardingAnalyzer.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { Service: 'events.amazonaws.com' },
            Condition: { StringEquals: { 'aws:SourceAccount': account } },
          }),
        ],
      },
    });
    forwardingAnalyzer.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Action: 'events:PutEvents',
            Resource: alertsBusArn,
          },
        ],
      },
    });
  });

  it('bounds the forwarding role with the CDK execution policy', () => {
    forwardingAnalyzer.hasResourceProperties('AWS::IAM::Role', {
      PermissionsBoundary: {
        'Fn::Join': [
          '',
          ['arn:', { Ref: 'AWS::Partition' }, `:iam::${account}:policy/cronista-cfn-execution`],
        ],
      },
    });
  });

  it('sends active findings of any region to the alerts topic in the alerts region', () => {
    alertsRegionAnalyzer.hasResourceProperties('AWS::Events::Rule', {
      Name: 'cronista-access-analyzer-findings',
      EventPattern: {
        source: ['aws.access-analyzer'],
        'detail-type': ['Access Analyzer Finding'],
        account: [account],
        detail: { status: ['ACTIVE'], isDeleted: [false] },
      },
      Targets: [Match.objectLike({ Arn: alertsTopicArn })],
    });
    alertsRegionAnalyzer.resourceCountIs('AWS::IAM::Role', 0);
  });

  it('turns each finding into readable text only where it reaches the topic', () => {
    alertsRegionAnalyzer.hasResourceProperties('AWS::Events::Rule', {
      Targets: [
        Match.objectLike({
          InputTransformer: {
            InputPathsMap: {
              'detail-resource': '$.detail.resource',
              'detail-resourceType': '$.detail.resourceType',
              'detail-isPublic': '$.detail.isPublic',
              'detail-region': '$.detail.region',
            },
            InputTemplate: [
              '"Access Analyzer: a resource is reachable from outside the account"',
              '"Resource: <detail-resource>"',
              '"Type: <detail-resourceType>"',
              '"Public: <detail-isPublic>"',
              '"Region: <detail-region>"',
              '"Console: https://<detail-region>.console.aws.amazon.com/access-analyzer/home?region=<detail-region>#/findings"',
            ].join('\n'),
          },
        }),
      ],
    });
    // The forwarder must pass the whole event on: the rule in the alerts region reads its fields.
    expect(JSON.stringify(forwardingAnalyzer.toJSON())).not.toContain('InputTransformer');
  });

  it('passes the AWS Solutions checks in the alerts region and in the forwarding one', () => {
    expect(nagFindings(alertsRegionStack)).toEqual([]);
    expect(nagFindings(forwardingStack)).toEqual([]);
  });
});
