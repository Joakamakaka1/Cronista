import {
  CfnOutput,
  CliCredentialsStackSynthesizer,
  Duration,
  type IStackSynthesizer,
  RemovalPolicy,
  Stack,
  type StackProps,
  Validations,
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
import { BlockPublicAccess, Bucket, BucketEncryption, CfnBucket } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

import { guardDutyFindingsRuleName, guardDutyForwarderRoleName } from './threat-detection-stack.ts';

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
    Validations.of(data).acknowledge({
      id: 'AwsSolutions-S1',
      reason:
        'The CDK execution policy denies every deploy any object write and delete here, so only ' +
        'the backups role and the owner write. Reads go unlogged; besides the read-only role ' +
        'and the owner, only the bootstrap lookup role and the roles a deploy from master uses ' +
        'or creates reach it.',
    });
    const cfnData = data.node.defaultChild;
    if (!(cfnData instanceof CfnBucket)) throw new Error('The data bucket has no CfnBucket.');
    // How cdk-nag writes the bucket's ARN in its finding IDs.
    const dataArnInFindings = `<${this.getLogicalId(cfnData)}.Arn>`;

    // What `cdk diff --method=template` reads. When the CDK CLI cannot assume the bootstrap lookup
    // role it goes on with these credentials, so these roles never get the lookup role's read
    // access to the whole account.
    const cronistaStacks = `arn:aws:cloudformation:*:${this.account}:stack/Cronista*/*`;
    const bootstrapVersions = `arn:aws:ssm:*:${this.account}:parameter/cdk-bootstrap/${bootstrapQualifier}/version`;
    const grantTemplateReads = (role: Role): void => {
      role.addToPolicy(
        new PolicyStatement({
          actions: ['cloudformation:DescribeStacks', 'cloudformation:GetTemplate'],
          resources: [cronistaStacks],
        }),
      );
      role.addToPolicy(
        new PolicyStatement({
          actions: ['ssm:GetParameter'],
          resources: [bootstrapVersions],
        }),
      );
      Validations.of(role).acknowledge(
        {
          id: `AwsSolutions-IAM5[Resource::${cronistaStacks}]`,
          reason:
            'Any region and any Cronista stack: `cdk diff` reads them all, in eu-west-1 and ' +
            'us-east-1, and every stack ARN ends in an ID that CloudFormation generates.',
        },
        {
          id: `AwsSolutions-IAM5[Resource::${bootstrapVersions}]`,
          reason: "Any region: the CLI checks the bootstrap version of every stack's region.",
        },
      );
    };

    // Pull requests only read: the stack templates and the private datasets.
    const readOnly = githubRole('ReadOnlyRole', 'cronista-github-readonly', 'pull_request');
    grantTemplateReads(readOnly);
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
    Validations.of(readOnly).acknowledge({
      id: `AwsSolutions-IAM5[Resource::${dataArnInFindings}/datasets/*]`,
      reason: 'The evals of a pull request may read any dataset, and nothing outside datasets/.',
    });

    // The plan of `deploy.yml` reads the templates too, and no data: it needs no approval, so it
    // gets nothing a deploy could use.
    const plan = githubRole('PlanRole', 'cronista-github-plan', 'environment:production-plan');
    grantTemplateReads(plan);

    // Both deploy workflows check the site by invoking `core-api` from inside AWS, because the geo
    // restriction refuses GitHub's runners. They read its name from the outputs of CronistaEdge, and
    // CloudFormation names it after that stack and its logical ID. Invoking it also lets a role forge
    // a Function URL event, which still needs a valid session token.
    const edgeStack = `arn:aws:cloudformation:eu-west-1:${this.account}:stack/CronistaEdge/*`;
    const coreApi = `arn:aws:lambda:eu-west-1:${this.account}:function:CronistaEdge-CoreApi*`;
    const grantSiteCheck = (role: Role): void => {
      role.addToPolicy(
        new PolicyStatement({
          actions: ['cloudformation:DescribeStacks'],
          resources: [edgeStack],
        }),
      );
      role.addToPolicy(
        new PolicyStatement({
          actions: ['lambda:InvokeFunction'],
          resources: [coreApi],
        }),
      );
      Validations.of(role).acknowledge(
        {
          id: `AwsSolutions-IAM5[Resource::${edgeStack}]`,
          reason: 'Only CronistaEdge, whose stack ARN ends in an ID that CloudFormation generates.',
        },
        {
          id: `AwsSolutions-IAM5[Resource::${coreApi}]`,
          reason:
            'Only core-api, whose name ends in a suffix that CloudFormation generates and which ' +
            'lives in another stack, so this one cannot reference it.',
        },
      );
    };

    // The front deploy (`deploy-web.yml`) syncs the site bucket and reads its name from the outputs
    // of CronistaEdge. CloudFormation names the bucket after that stack and its logical ID.
    const web = githubRole('WebRole', 'cronista-github-web', 'environment:production-web');
    const siteBucket = 'arn:aws:s3:::cronistaedge-sitebucket*';
    // Bucket ARNs carry no account, so this rules out a bucket of the same name elsewhere.
    const inThisAccount = { StringEquals: { 's3:ResourceAccount': this.account } };
    web.addToPolicy(
      new PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [siteBucket],
        conditions: inThisAccount,
      }),
    );
    web.addToPolicy(
      new PolicyStatement({
        actions: ['s3:PutObject', 's3:DeleteObject'],
        resources: [`${siteBucket}/*`],
        conditions: inThisAccount,
      }),
    );
    grantSiteCheck(web);
    const siteReason =
      'Only the site bucket of CronistaEdge in this account, whose name ends in a suffix that ' +
      'CloudFormation generates; the sync adds, replaces and deletes any of its files.';
    Validations.of(web).acknowledge(
      { id: `AwsSolutions-IAM5[Resource::${siteBucket}]`, reason: siteReason },
      { id: `AwsSolutions-IAM5[Resource::${siteBucket}/*]`, reason: siteReason },
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
    grantSiteCheck(deploy);

    // Write-only: a leaked token can add a dump, never read, list or delete one. Versioning keeps
    // what an overwrite replaces.
    const backups = githubRole('BackupsRole', 'cronista-github-backups', 'ref:refs/heads/master');
    backups.addToPolicy(
      new PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [data.arnForObjects('backups/*')],
      }),
    );
    Validations.of(backups).acknowledge({
      id: `AwsSolutions-IAM5[Resource::${dataArnInFindings}/backups/*]`,
      reason:
        'Every dump is a new object under backups/; the role can only write objects there, and ' +
        'versioning keeps what an overwrite replaces.',
    });

    const executionPolicyArn = `arn:aws:iam::${this.account}:policy/${executionPolicyName}`;
    const executionPolicy = new ManagedPolicy(this, 'CfnExecutionPolicy', {
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
            // Changing the trail, the analyzers or the detectors therefore needs a stack created and
            // deployed with the owner's CLI credentials (`CliCredentialsStackSynthesizer`).
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
              // Disabling the detector or a protection is an update.
              'guardduty:DeleteDetector',
              'guardduty:UpdateDetector',
              // Suppression rules, archived findings and trusted IP or entity lists all hide findings.
              'guardduty:CreateFilter',
              'guardduty:UpdateFilter',
              'guardduty:ArchiveFindings',
              'guardduty:CreateIPSet',
              'guardduty:UpdateIPSet',
              'guardduty:CreateTrustedEntitySet',
              'guardduty:UpdateTrustedEntitySet',
              'guardduty:UpdateMalwareScanSettings',
              // An administrator account could turn off a member's detector.
              'guardduty:AcceptAdministratorInvitation',
              'guardduty:AcceptInvitation',
              'guardduty:DisassociateFromAdministratorAccount',
              'guardduty:DisassociateFromMasterAccount',
            ],
            resources: ['*'],
          }),
          new PolicyStatement({
            effect: Effect.DENY,
            actions: [
              'events:DeleteRule',
              'events:DisableRule',
              'events:PutRule',
              'events:PutTargets',
              'events:RemoveTargets',
            ],
            // The rules that carry GuardDuty findings to the alerts topic, in every region.
            resources: [`arn:aws:events:*:${this.account}:rule/${guardDutyFindingsRuleName}`],
          }),
          new PolicyStatement({
            effect: Effect.DENY,
            // A bus policy that denies the forwarders, or a key they cannot use, would drop the
            // findings that other regions forward to the alerts region. No stack sets either.
            actions: ['events:PutPermission', 'events:RemovePermission', 'events:UpdateEventBus'],
            resources: [`arn:aws:events:*:${this.account}:event-bus/default`],
          }),
          new PolicyStatement({
            effect: Effect.DENY,
            actions: [
              's3:PutObject*',
              's3:DeleteObject*',
              // A deploy's own bucket could replicate objects or delete markers into a versioned one.
              's3:Replicate*',
              's3:DeleteBucket',
              's3:PutBucketPolicy',
              's3:DeleteBucketPolicy',
              's3:PutBucketVersioning',
              's3:PutLifecycleConfiguration',
            ],
            // The audit logs and the data bucket's datasets and dumps. CloudFormation names the
            // trail bucket after its stack and logical ID.
            resources: [
              'arn:aws:s3:::cronistaaccountguards-traillogs*',
              'arn:aws:s3:::cronistaaccountguards-traillogs*/*',
              data.bucketArn,
              data.arnForObjects('*'),
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
            // The bootstrap roles trust the whole account and carry no boundary: a bounded role
            // that assumed the file publishing one could replace assets after all.
            actions: ['sts:AssumeRole', 'sts:TagSession'],
            resources: [`arn:aws:iam::${this.account}:role/cdk-${bootstrapQualifier}-*`],
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
              `arn:aws:iam::${this.account}:role/${guardDutyForwarderRoleName}`,
              `arn:aws:iam::${this.account}:oidc-provider/${githubIssuer}`,
            ],
          }),
        ],
      }),
    });
    const executionPolicyReason =
      'CloudFormation creates whatever the stacks declare, so it needs every action on every ' +
      'resource; the denies remove persistence, hiding and loosening these limits.';
    Validations.of(executionPolicy).acknowledge(
      { id: 'AwsSolutions-IAM5[Action::*]', reason: executionPolicyReason },
      { id: 'AwsSolutions-IAM5[Resource::*]', reason: executionPolicyReason },
    );

    new CfnOutput(this, 'DataBucketName', { value: data.bucketName });
    new CfnOutput(this, 'ReadOnlyRoleArn', { value: readOnly.roleArn });
    new CfnOutput(this, 'DeployRoleArn', { value: deploy.roleArn });
    new CfnOutput(this, 'BackupsRoleArn', { value: backups.roleArn });
    new CfnOutput(this, 'PlanRoleArn', { value: plan.roleArn });
    new CfnOutput(this, 'WebRoleArn', { value: web.roleArn });
  }
}
