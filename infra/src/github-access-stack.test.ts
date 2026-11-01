import { App, CliCredentialsStackSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { GitHubAccessStack } from './github-access-stack.ts';
import { nagFindings } from './nag-findings.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

const subjectPrefix = 'repo:Joakamakaka1@129002508/Cronista@1403206949';

let accessStack: GitHubAccessStack;
let access: Template;

beforeAll(() => {
  const app = new App({ context: cdkConfig.context });
  accessStack = new GitHubAccessStack(app, 'GitHubAccess', {
    env: { account, region: 'eu-west-1' },
  });
  access = Template.fromStack(accessStack);
});

/** Asserts the exact statements of the inline policy CDK attaches to the role with this name. */
function expectRolePolicy(roleName: string, statements: unknown[]): void {
  const [roleId] = Object.keys(
    access.findResources('AWS::IAM::Role', { Properties: { RoleName: roleName } }),
  );
  access.hasResourceProperties('AWS::IAM::Policy', {
    Roles: [{ Ref: roleId }],
    PolicyDocument: { Statement: statements },
  });
}

const bucketArn = { 'Fn::GetAtt': [Match.anyValue(), 'Arn'] };

describe('GitHubAccessStack', () => {
  it('deploys with the CLI credentials, never through the CloudFormation execution role', () => {
    expect(accessStack.synthesizer).toBeInstanceOf(CliCredentialsStackSynthesizer);
    expect(access.toJSON()).not.toHaveProperty('Parameters.BootstrapVersion');
  });

  it('creates the GitHub OIDC provider for the STS audience', () => {
    access.resourceCountIs('AWS::IAM::OIDCProvider', 1);
    access.hasResourceProperties('AWS::IAM::OIDCProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIdList: ['sts.amazonaws.com'],
    });
  });

  it.each([
    ['cronista-github-readonly', `${subjectPrefix}:pull_request`],
    ['cronista-github-deploy', `${subjectPrefix}:environment:production`],
    ['cronista-github-backups', `${subjectPrefix}:ref:refs/heads/master`],
    ['cronista-github-plan', `${subjectPrefix}:environment:production-plan`],
    ['cronista-github-web', `${subjectPrefix}:environment:production-web`],
  ])('lets only one exact GitHub subject assume %s', (roleName, subject) => {
    access.hasResourceProperties('AWS::IAM::Role', {
      RoleName: roleName,
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub': subject,
              },
            },
          },
        ],
      },
    });
  });

  it('lets the deploy role assume only the CDK bootstrap roles of both regions, and run the site check', () => {
    expectRolePolicy('cronista-github-deploy', [
      {
        Effect: 'Allow',
        Action: 'sts:AssumeRole',
        Resource: ['deploy', 'file-publishing', 'image-publishing', 'lookup'].flatMap((kind) =>
          ['eu-west-1', 'us-east-1'].map(
            (region) =>
              `arn:aws:iam::${account}:role/cdk-hnb659fds-${kind}-role-${account}-${region}`,
          ),
        ),
      },
      {
        Effect: 'Allow',
        Action: 'cloudformation:DescribeStacks',
        Resource: `arn:aws:cloudformation:eu-west-1:${account}:stack/CronistaEdge/*`,
      },
      {
        Effect: 'Allow',
        Action: 'lambda:InvokeFunction',
        Resource: `arn:aws:lambda:eu-west-1:${account}:function:CronistaEdge-CoreApi*`,
      },
    ]);
  });

  it('lets the backups role only write new objects under backups/', () => {
    expectRolePolicy('cronista-github-backups', [
      {
        Effect: 'Allow',
        Action: 's3:PutObject',
        Resource: { 'Fn::Join': ['', [bucketArn, '/backups/*']] },
      },
    ]);
  });

  it('lets the read-only role read stack templates and datasets, and nothing else', () => {
    expectRolePolicy('cronista-github-readonly', [
      {
        Effect: 'Allow',
        Action: ['cloudformation:DescribeStacks', 'cloudformation:GetTemplate'],
        Resource: `arn:aws:cloudformation:*:${account}:stack/Cronista*/*`,
      },
      {
        Effect: 'Allow',
        Action: 'ssm:GetParameter',
        Resource: `arn:aws:ssm:*:${account}:parameter/cdk-bootstrap/hnb659fds/version`,
      },
      {
        Effect: 'Allow',
        Action: 's3:ListBucket',
        Resource: bucketArn,
        Condition: { StringLike: { 's3:prefix': 'datasets/*' } },
      },
      {
        Effect: 'Allow',
        Action: 's3:GetObject',
        Resource: { 'Fn::Join': ['', [bucketArn, '/datasets/*']] },
      },
    ]);
  });

  it('lets the plan role read stack templates, and nothing else', () => {
    expectRolePolicy('cronista-github-plan', [
      {
        Effect: 'Allow',
        Action: ['cloudformation:DescribeStacks', 'cloudformation:GetTemplate'],
        Resource: `arn:aws:cloudformation:*:${account}:stack/Cronista*/*`,
      },
      {
        Effect: 'Allow',
        Action: 'ssm:GetParameter',
        Resource: `arn:aws:ssm:*:${account}:parameter/cdk-bootstrap/hnb659fds/version`,
      },
    ]);
  });

  it("lets the web role only sync this account's site bucket, read its name and run the site check", () => {
    const inThisAccount = { StringEquals: { 's3:ResourceAccount': account } };
    expectRolePolicy('cronista-github-web', [
      {
        Effect: 'Allow',
        Action: 's3:ListBucket',
        Resource: 'arn:aws:s3:::cronistaedge-sitebucket*',
        Condition: inThisAccount,
      },
      {
        Effect: 'Allow',
        Action: ['s3:PutObject', 's3:DeleteObject'],
        Resource: 'arn:aws:s3:::cronistaedge-sitebucket*/*',
        Condition: inThisAccount,
      },
      {
        Effect: 'Allow',
        Action: 'cloudformation:DescribeStacks',
        Resource: `arn:aws:cloudformation:eu-west-1:${account}:stack/CronistaEdge/*`,
      },
      {
        Effect: 'Allow',
        Action: 'lambda:InvokeFunction',
        Resource: `arn:aws:lambda:eu-west-1:${account}:function:CronistaEdge-CoreApi*`,
      },
    ]);
  });

  it('gives CloudFormation every action except persistence, hiding and account changes', () => {
    access.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      ManagedPolicyName: 'cronista-cfn-execution',
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Allow', Action: '*', Resource: '*' }),
          Match.objectLike({
            Effect: 'Deny',
            Action: 'iam:*',
            Resource: [`arn:aws:iam::${account}:user/*`, `arn:aws:iam::${account}:group/*`],
          }),
          Match.objectLike({
            Effect: 'Deny',
            Action: ['iam:CreateOpenIDConnectProvider', 'iam:CreateSAMLProvider'],
          }),
          Match.objectLike({
            Effect: 'Deny',
            Action: Match.arrayWith([
              'cloudtrail:StopLogging',
              'cloudtrail:PutEventSelectors',
              'access-analyzer:DeleteAnalyzer',
              'access-analyzer:CreateArchiveRule',
            ]),
          }),
          Match.objectLike({
            Effect: 'Deny',
            Action: Match.arrayWith([
              's3:PutObject*',
              's3:DeleteObject*',
              's3:PutBucketVersioning',
            ]),
            // The live bucket keeps the name from its first stack; a replacement gets the second.
            Resource: Match.arrayWith([
              'arn:aws:s3:::cronistaaccountguards-traillogs*',
              'arn:aws:s3:::cronistaaccountguards-traillogs*/*',
              'arn:aws:s3:::cronistaaudittrail-traillogs*',
              'arn:aws:s3:::cronistaaudittrail-traillogs*/*',
            ]),
          }),
          Match.objectLike({
            Effect: 'Deny',
            Action: ['s3:PutObject*', 's3:DeleteObject*', 's3:PutBucketPolicy'],
            Resource: Match.arrayWith(['arn:aws:s3:::cdk-hnb659fds-assets-*/*']),
          }),
          Match.objectLike({
            Effect: 'Deny',
            Action: ['sts:AssumeRole', 'sts:TagSession'],
            Resource: `arn:aws:iam::${account}:role/cdk-hnb659fds-*`,
          }),
          Match.objectLike({
            Effect: 'Deny',
            Action: Match.arrayWith(['organizations:AcceptHandshake', 'account:Put*']),
          }),
        ]),
      },
    });
  });

  it('works as a permissions boundary that every new role must carry', () => {
    access.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: ['iam:CreateRole', 'iam:PutRolePermissionsBoundary'],
            Resource: '*',
            Condition: {
              StringNotEquals: {
                'iam:PermissionsBoundary': `arn:aws:iam::${account}:policy/cronista-cfn-execution`,
              },
            },
          }),
          Match.objectLike({
            Effect: 'Deny',
            Action: 'iam:DeleteRolePermissionsBoundary',
            Resource: '*',
          }),
        ]),
      },
    });
  });

  it('gives its own roles no boundary, since they would need the policy before it exists', () => {
    for (const role of Object.values(access.findResources('AWS::IAM::Role'))) {
      expect(role).not.toHaveProperty('Properties.PermissionsBoundary');
    }
  });

  it('keeps CloudFormation from changing its own limits or the GitHub access', () => {
    const [policy] = Object.values(access.findResources('AWS::IAM::ManagedPolicy'));
    const document = JSON.stringify(policy);
    for (const protectedArn of [
      `arn:aws:iam::${account}:policy/cronista-cfn-execution`,
      `arn:aws:iam::${account}:role/cdk-hnb659fds-*`,
      `arn:aws:iam::${account}:role/cronista-github-*`,
      `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`,
    ]) {
      expect(document).toContain(protectedArn);
    }
    for (const action of [
      'iam:CreatePolicyVersion',
      'iam:AttachRolePolicy',
      'iam:PutRolePolicy',
      'iam:UpdateAssumeRolePolicy',
      'iam:DeleteRole',
      'iam:DeleteOpenIDConnectProvider',
    ]) {
      expect(document).toContain(`"${action}"`);
    }
  });

  it('keeps CloudFormation from blinding GuardDuty or cutting its findings off', () => {
    access.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: Match.arrayWith([
              'guardduty:DeleteDetector',
              'guardduty:UpdateDetector',
              'guardduty:CreateFilter',
              'guardduty:UpdateFilter',
              'guardduty:ArchiveFindings',
              'guardduty:CreateIPSet',
              'guardduty:UpdateIPSet',
              'guardduty:CreateTrustedEntitySet',
              'guardduty:UpdateTrustedEntitySet',
              'guardduty:AcceptAdministratorInvitation',
              'guardduty:DisassociateFromAdministratorAccount',
            ]),
            Resource: '*',
          }),
          Match.objectLike({
            Effect: 'Deny',
            Action: [
              'events:DeleteRule',
              'events:DisableRule',
              'events:PutRule',
              'events:PutTargets',
              'events:RemoveTargets',
            ],
            Resource: `arn:aws:events:*:${account}:rule/cronista-guardduty-findings`,
          }),
          Match.objectLike({
            Effect: 'Deny',
            Action: ['events:PutPermission', 'events:RemovePermission', 'events:UpdateEventBus'],
            Resource: `arn:aws:events:*:${account}:event-bus/default`,
          }),
          Match.objectLike({
            Effect: 'Deny',
            Action: Match.arrayWith(['iam:PutRolePolicy', 'iam:DeleteRole']),
            Resource: Match.arrayWith([
              `arn:aws:iam::${account}:role/cronista-guardduty-forwarder`,
            ]),
          }),
        ]),
      },
    });
  });

  it('keeps the data bucket private, versioned and retained', () => {
    access.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        VersioningConfiguration: { Status: 'Enabled' },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
          ],
        },
      }),
    });
    access.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('denies deploys every write and delete in the data bucket, as in the trail bucket', () => {
    const [dataId] = Object.keys(access.findResources('AWS::S3::Bucket'));
    const dataArn = { 'Fn::GetAtt': [dataId, 'Arn'] };
    access.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: Match.arrayWith([
              's3:PutObject*',
              's3:DeleteObject*',
              's3:Replicate*',
              's3:DeleteBucket',
              's3:PutBucketPolicy',
              's3:PutBucketVersioning',
              's3:PutLifecycleConfiguration',
            ]),
            Resource: Match.arrayWith([
              'arn:aws:s3:::cronistaaccountguards-traillogs*/*',
              dataArn,
              { 'Fn::Join': ['', [dataArn, '/*']] },
            ]),
          }),
        ]),
      },
    });
  });

  it('expires backups after 90 days, keeps datasets and drops old versions and leftovers', () => {
    access.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: [
          { Prefix: 'backups/', Status: 'Enabled', ExpirationInDays: 90 },
          {
            Status: 'Enabled',
            NoncurrentVersionExpiration: { NoncurrentDays: 90 },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
            ExpiredObjectDeleteMarker: true,
          },
        ],
      },
    });
  });

  it('never writes an email into the template', () => {
    expect(JSON.stringify(access.toJSON())).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  });

  it('passes the AWS Solutions checks', () => {
    expect(nagFindings(accessStack)).toEqual([]);
  });
});
