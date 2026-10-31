import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { AccessAnalyzerStack } from './access-analyzer-stack.ts';
import { nagFindings } from './nag-findings.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

const alertsRegion = 'eu-west-1';

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

  it('leaves the alerts region to the rule that publishes the alerts', () => {
    alertsRegionAnalyzer.resourceCountIs('AWS::Events::Rule', 0);
    alertsRegionAnalyzer.resourceCountIs('AWS::IAM::Role', 0);
  });

  it('passes the AWS Solutions checks in the alerts region and in the forwarding one', () => {
    expect(nagFindings(alertsRegionStack)).toEqual([]);
    expect(nagFindings(forwardingStack)).toEqual([]);
  });
});
