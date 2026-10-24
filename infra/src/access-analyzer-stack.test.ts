import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { AccessAnalyzerStack } from './access-analyzer-stack.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

const alertsRegion = 'eu-west-1';

const alertsBusArn = {
  'Fn::Join': [
    '',
    ['arn:', { Ref: 'AWS::Partition' }, `:events:${alertsRegion}:${account}:event-bus/default`],
  ],
};

let alertsRegionAnalyzer: Template;
let forwardingAnalyzer: Template;

beforeAll(() => {
  // One app per stack: synthesizing an app freezes it.
  const analyzerIn = (region: string): Template =>
    Template.fromStack(
      new AccessAnalyzerStack(new App({ context: cdkConfig.context }), 'Analyzer', {
        env: { account, region },
        alertsRegion,
      }),
    );
  alertsRegionAnalyzer = analyzerIn(alertsRegion);
  forwardingAnalyzer = analyzerIn('us-east-1');
});

describe('AccessAnalyzerStack', () => {
  it('creates the one account analyzer a region allows', () => {
    for (const analyzer of [alertsRegionAnalyzer, forwardingAnalyzer]) {
      analyzer.resourceCountIs('AWS::AccessAnalyzer::Analyzer', 1);
      analyzer.hasResourceProperties('AWS::AccessAnalyzer::Analyzer', { Type: 'ACCOUNT' });
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
});
