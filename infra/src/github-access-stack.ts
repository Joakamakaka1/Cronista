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
  PermissionsBoundary,
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
 * bucket they share, and the policy that is both CloudFormation's execution policy and the
 * permissions boundary of every role the app creates.
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

    // The app gives every role the boundary this stack creates (`cdk.json`); these roles would
    // need the policy before it exists, and the policy already protects them by name.
    PermissionsBoundary.of(this).clear();

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
        { prefix: 'backups/', expiration: backupRetention },
        {
          // Versioning keeps overwritten datasets and expired dumps: drop them after the same
          // window, with the parts of uploads that never finished and the markers left behind.
          noncurrentVersionExpiration: backupRetention,
          abortIncompleteMultipartUploadAfter: Duration.days(1),
          expiredObjectDeleteMarker: true,
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
        // Any region: the CLI checks the bootstrap version of every stack's region.
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

    const executionPolicyArn = `arn:aws:iam::${this.account}:policy/${executionPolicyName}`;
    new ManagedPolicy(this, 'CfnExecutionPolicy', {
      managedPolicyName: executionPolicyName,
      description:
        'CDK execution policy and permissions boundary: everything except persistence, hiding and loosening these limits.',
      document: new PolicyDocument({
        statements: [
          // CloudFormation creates whatever the stacks declare, so it needs every action; the
          // denies below remove what a malicious deploy would use to stay or to hide.
          new PolicyStatement({ actions: ['*'], resources: ['*'] }),
          new PolicyStatement({
            effect: Effect.DENY,
            actions: ['iam:*'],
            // Any user or group: the stacks never declare one, and the owner's user lives here.
            resources: [
              `arn:aws:iam::${this.account}:user/*`,
              `arn:aws:iam::${this.account}:group/*`,
            ],
          }),
          new PolicyStatement({
            effect: Effect.DENY,
            actions: ['iam:CreateOpenIDConnectProvider', 'iam:CreateSAMLProvider'],
            resources: ['*'],
          }),
          // As a permissions boundary, this policy only binds if every new role carries it: a
          // role without it could do everything denied here on behalf of the deploy.
          new PolicyStatement({
            effect: Effect.DENY,
            actions: ['iam:CreateRole', 'iam:PutRolePermissionsBoundary'],
            resources: ['*'],
            conditions: { StringNotEquals: { 'iam:PermissionsBoundary': executionPolicyArn } },
          }),
          new PolicyStatement({
            effect: Effect.DENY,
            actions: ['iam:DeleteRolePermissionsBoundary'],
            resources: ['*'],
          }),
          new PolicyStatement({
            effect: Effect.DENY,
            // Changing the trail or the analyzer of CronistaAccountGuards and
            // CronistaAccessAnalyzer-* therefore needs a deploy with the owner's CLI credentials.
            actions: [
              'cloudtrail:StopLogging',
              'cloudtrail:DeleteTrail',
              'cloudtrail:UpdateTrail',
              'cloudtrail:PutEventSelectors',
              'access-analyzer:DeleteAnalyzer',
              'access-analyzer:CreateArchiveRule',
              'access-analyzer:UpdateArchiveRule',
              'access-analyzer:ApplyArchiveRule',
              'access-analyzer:UpdateFindings',
            ],
            resources: ['*'],
          }),
          new PolicyStatement({
            effect: Effect.DENY,
            actions: [
              's3:DeleteObject*',
              's3:DeleteBucket',
              's3:PutBucketPolicy',
              's3:DeleteBucketPolicy',
              's3:PutLifecycleConfiguration',
            ],
            // CloudFormation names the trail bucket after its stack and logical ID.
            resources: [
              'arn:aws:s3:::cronistaaccountguards-traillogs*',
              'arn:aws:s3:::cronistaaccountguards-traillogs*/*',
            ],
          }),
          new PolicyStatement({
            effect: Effect.DENY,
            // Only the file publishing role uploads assets; a replaced zip would keep running,
            // because publishing skips hashes that already exist.
            actions: ['s3:PutObject*', 's3:DeleteObject*', 's3:PutBucketPolicy'],
            resources: [
              `arn:aws:s3:::cdk-${bootstrapQualifier}-assets-*`,
              `arn:aws:s3:::cdk-${bootstrapQualifier}-assets-*/*`,
            ],
          }),
          new PolicyStatement({
            effect: Effect.DENY,
            // Write actions only: services may read account and organization details as the caller.
            actions: [
              'organizations:AcceptHandshake',
              'organizations:CreateOrganization',
              'organizations:LeaveOrganization',
              'account:Put*',
              'account:Delete*',
              'account:EnableRegion',
              'account:DisableRegion',
              'account:StartPrimaryEmailUpdate',
              'account:AcceptPrimaryEmailUpdate',
            ],
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
              'iam:DeleteOpenIDConnectProvider',
              'iam:AddClientIDToOpenIDConnectProvider',
              'iam:RemoveClientIDFromOpenIDConnectProvider',
              'iam:UpdateOpenIDConnectProviderThumbprint',
            ],
            // Names, not references: the bootstrap roles belong to the bootstrap stacks. All of
            // them, because a trust change on the deploy role would let another account deploy.
            resources: [
              executionPolicyArn,
              `arn:aws:iam::${this.account}:role/cdk-${bootstrapQualifier}-*`,
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
