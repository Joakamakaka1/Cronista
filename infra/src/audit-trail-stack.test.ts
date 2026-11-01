import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { AuditTrailStack } from './audit-trail-stack.ts';
import { nagFindings } from './nag-findings.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

let trailStack: AuditTrailStack;
let trail: Template;

beforeAll(() => {
  const app = new App({ context: cdkConfig.context });
  trailStack = new AuditTrailStack(app, 'Trail', { env: { account, region: 'eu-west-1' } });
  trail = Template.fromStack(trailStack);
});

describe('AuditTrailStack', () => {
  it('deploys with the CLI credentials, never through the CloudFormation execution role', () => {
    expect(trail.toJSON()).not.toHaveProperty('Parameters.BootstrapVersion');
  });

  it('records management events in every region with file validation', () => {
    trail.resourceCountIs('AWS::CloudTrail::Trail', 1);
    trail.hasResourceProperties('AWS::CloudTrail::Trail', {
      IsMultiRegionTrail: true,
      IncludeGlobalServiceEvents: true,
      EnableLogFileValidation: true,
    });
  });

  it('keeps the logical IDs that the import maps', () => {
    expect(Object.keys(trail.findResources('AWS::CloudTrail::Trail'))).toEqual([
      'ManagementEventsC6D238C8',
    ]);
    expect(Object.keys(trail.findResources('AWS::S3::Bucket'))).toEqual(['TrailLogs3B05809D']);
    expect(Object.keys(trail.findResources('AWS::S3::BucketPolicy'))).toEqual([
      'TrailLogsPolicy3022A450',
    ]);
  });

  it('refuses trail writes that come from another account', () => {
    trail.hasResourceProperties('AWS::S3::BucketPolicy', {
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
    trail.hasResourceProperties('AWS::S3::Bucket', {
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

  it.each(['AWS::CloudTrail::Trail', 'AWS::S3::Bucket', 'AWS::S3::BucketPolicy'])(
    'keeps the %s when it leaves the stack',
    (type) => {
      trail.hasResource(type, { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
    },
  );

  it('passes the AWS Solutions checks', () => {
    expect(nagFindings(trailStack)).toEqual([]);
  });
});
