import {
  CfnOutput,
  CliCredentialsStackSynthesizer,
  Duration,
  type IStackSynthesizer,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import {
  Effect,
  ManagedPolicy,
  OidcProviderNative,
  PolicyDocument,
  PolicyStatement,
  Role,
  WebIdentityPrincipal,
} from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

// Repos created after 2026-07-15 get a `sub` with the owner and repo IDs, which survive renames.
// Both IDs are public (GitHub's API returns them to anyone).
const githubSubject = 'repo:Joakamakaka1@129002508/Cronista@1403206949';

const githubIssuer = 'token.actions.githubusercontent.com';

const stsAudience = 'sts.amazonaws.com';

const bootstrapQualifier = 'hnb659fds';

const executionPolicyName = 'cronista-cfn-execution';

const backupRetention = Duration.days(90);

/**
 * What GitHub Actions may do in AWS: the OIDC provider, one role per kind of job, the private data
 * bucket they share and the policy CloudFormation deploys with.
 *
 * @remarks
 * It deploys with the CLI credentials of the owner's machine, never through the bootstrap roles, so
 * the CloudFormation execution role it limits cannot change it. CI never deploys this stack.
 */
export class GitHubAccessStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, {
      ...props,
      // CDK types bootstrapQualifier as `string | undefined`, which IStackSynthesizer rejects
      // under exactOptionalPropertyTypes; the object is a plain CLI credentials synthesizer.
      synthesizer: new CliCredentialsStackSynthesizer() as IStackSynthesizer,
    });

    const provider = new OidcProviderNative(this, 'GitHubOidc', {
      url: `https://${githubIssuer}`,
      clientIds: [stsAudience],
    });
    const githubRole = (constructId: string, roleName: string, subject: string): Role =>
      new Role(this, constructId, {
        roleName,
        maxSessionDuration: Duration.hours(1),
        assumedBy: new WebIdentityPrincipal(provider.oidcProviderArn, {
          StringEquals: {
            [`${githubIssuer}:aud`]: stsAudience,
            [`${githubIssuer}:sub`]: `${githubSubject}:${subject}`,
          },
        }),
      });

    // Datasets for the evals and encrypted database dumps: never in the public repo.
    const data = new Bucket(this, 'DataBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          prefix: 'backups/',
          expiration: backupRetention,
          noncurrentVersionExpiration: backupRetention,
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Pull requests only read: `cdk diff --method=template` and the private datasets. When the CDK
    // CLI cannot assume the bootstrap lookup role it goes on with these credentials, so the role
    // never gets the lookup role's read access to the whole account.
    const readOnly = githubRole('ReadOnlyRole', 'cronista-github-readonly', 'pull_request');
    readOnly.addToPolicy(
      new PolicyStatement({
        actions: ['cloudformation:DescribeStacks', 'cloudformation:GetTemplate'],
        // Any region: the app has stacks in eu-west-1 and us-east-1.
        resources: [`arn:aws:cloudformation:*:${this.account}:stack/Cronista*/*`],
      }),
    );
    readOnly.addToPolicy(
      new PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:*:${this.account}:parameter/cdk-bootstrap/${bootstrapQualifier}/version`,
        ],
      }),
    );
    readOnly.addToPolicy(
      new PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [data.bucketArn],
        conditions: { StringLike: { 's3:prefix': 'datasets/*' } },
      }),
    );
    readOnly.addToPolicy(
      new PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [data.arnForObjects('datasets/*')],
      }),
    );

    // Only a job in the `production` environment, which GitHub limits to master, gets this subject.
    const deploy = githubRole('DeployRole', 'cronista-github-deploy', 'environment:production');
    deploy.addToPolicy(
      new PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: ['deploy', 'file-publishing', 'image-publishing', 'lookup'].flatMap((kind) =>
          ['eu-west-1', 'us-east-1'].map(
            (region) =>
              `arn:aws:iam::${this.account}:role/cdk-${bootstrapQualifier}-${kind}-role-${this.account}-${region}`,
          ),
        ),
      }),
    );

    // Write-only: a leaked token can add a dump, never read, list or delete one. Versioning keeps
    // what an overwrite replaces.
    const backups = githubRole('BackupsRole', 'cronista-github-backups', 'ref:refs/heads/master');
    backups.addToPolicy(
      new PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [data.arnForObjects('backups/*')],
      }),
    );

    new ManagedPolicy(this, 'CfnExecutionPolicy', {
      managedPolicyName: executionPolicyName,
      description:
        'CDK bootstrap execution policy: everything except persistence, audit and account changes.',
      document: new PolicyDocument({
        statements: [
          // CloudFormation creates whatever the stacks declare, so it needs every action; the
          // denies below remove what a malicious deploy would use to stay or to hide.
          new PolicyStatement({ actions: ['*'], resources: ['*'] }),
          new PolicyStatement({
            effect: Effect.DENY,
            actions: [
              'iam:CreateUser',
              'iam:CreateAccessKey',
              'iam:CreateLoginProfile',
              'iam:UpdateLoginProfile',
              'iam:AttachUserPolicy',
              'iam:PutUserPolicy',
              'iam:AddUserToGroup',
              'iam:CreateOpenIDConnectProvider',
              'iam:CreateSAMLProvider',
            ],
            resources: ['*'],
          }),
          new PolicyStatement({
            effect: Effect.DENY,
            actions: ['cloudtrail:StopLogging', 'cloudtrail:DeleteTrail'],
            resources: ['*'],
          }),
          new PolicyStatement({
            effect: Effect.DENY,
            actions: ['organizations:*', 'account:*'],
            resources: ['*'],
          }),
          new PolicyStatement({
            effect: Effect.DENY,
            actions: [
              'iam:CreatePolicyVersion',
              'iam:DeletePolicy',
              'iam:DeletePolicyVersion',
              'iam:SetDefaultPolicyVersion',
              'iam:AttachRolePolicy',
              'iam:DetachRolePolicy',
              'iam:PutRolePolicy',
              'iam:DeleteRolePolicy',
              'iam:UpdateAssumeRolePolicy',
              'iam:UpdateRole',
              'iam:DeleteRole',
              'iam:PutRolePermissionsBoundary',
              'iam:DeleteRolePermissionsBoundary',
              'iam:DeleteOpenIDConnectProvider',
              'iam:AddClientIDToOpenIDConnectProvider',
              'iam:RemoveClientIDFromOpenIDConnectProvider',
              'iam:UpdateOpenIDConnectProviderThumbprint',
            ],
            // Names, not references: the execution roles belong to the bootstrap stacks.
            resources: [
              `arn:aws:iam::${this.account}:policy/${executionPolicyName}`,
              `arn:aws:iam::${this.account}:role/cdk-${bootstrapQualifier}-cfn-exec-role-*`,
              `arn:aws:iam::${this.account}:role/cronista-github-*`,
              `arn:aws:iam::${this.account}:oidc-provider/${githubIssuer}`,
            ],
          }),
        ],
      }),
    });

    new CfnOutput(this, 'DataBucketName', { value: data.bucketName });
    new CfnOutput(this, 'ReadOnlyRoleArn', { value: readOnly.roleArn });
    new CfnOutput(this, 'DeployRoleArn', { value: deploy.roleArn });
    new CfnOutput(this, 'BackupsRoleArn', { value: backups.roleArn });
  }
}
