import {
  CliCredentialsStackSynthesizer,
  Duration,
  type IStackSynthesizer,
  RemovalPolicy,
  Stack,
  type StackProps,
  Validations,
} from 'aws-cdk-lib';
import { Trail } from 'aws-cdk-lib/aws-cloudtrail';
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket, BucketEncryption, type IBucket } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

const trailLogRetention = Duration.days(90);

/**
 * The CloudTrail trail of the account and the bucket of its logs.
 *
 * @remarks
 * It deploys with the CLI credentials of the owner's machine, like `CronistaThreatDetection-*`: the
 * CloudFormation execution policy denies every deploy changing the trail or writing to its bucket.
 * The trail, the bucket and its policy were imported into this stack, not created, so they keep
 * their names and their logs (see "The CloudTrail trail" in `docs/development.md`).
 */
export class AuditTrailStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, {
      ...props,
      // CDK types bootstrapQualifier as `string | undefined`, which IStackSynthesizer rejects
      // under exactOptionalPropertyTypes; the object is a plain CLI credentials synthesizer.
      synthesizer: new CliCredentialsStackSynthesizer() as IStackSynthesizer,
    });

    // The import maps the logical IDs of these constructs: keep their IDs.
    const trailLogs = new Bucket(this, 'TrailLogs', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: trailLogRetention }],
      // Audit logs outlive the stack: deleting it must not delete the evidence.
      removalPolicy: RemovalPolicy.RETAIN,
    });
    Validations.of(trailLogs).acknowledge({
      id: 'AwsSolutions-S1',
      reason:
        'Log file validation detects a changed or deleted trail log, and the CDK execution ' +
        'policy denies every deploy any object write and delete here. Reads go unlogged; only the ' +
        'owner, the bootstrap lookup role and the roles a deploy from master uses or creates ' +
        'reach them.',
    });
    // The policy CDK writes for CloudTrail has no source condition, so another account's trail
    // could write into this bucket under our prefix.
    trailLogs.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.DENY,
        principals: [new ServicePrincipal('cloudtrail.amazonaws.com')],
        actions: ['s3:GetBucketAcl', 's3:PutObject'],
        resources: [trailLogs.bucketArn, trailLogs.arnForObjects('*')],
        conditions: { StringNotEquals: { 'aws:SourceAccount': this.account } },
      }),
    );
    const trail = new Trail(this, 'ManagementEvents', {
      // CDK types Bucket.isWebsite as `boolean | undefined`, which IBucket rejects under
      // exactOptionalPropertyTypes; the object is the bucket created just above.
      bucket: trailLogs as IBucket,
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
      enableFileValidation: true,
    });
    trail.applyRemovalPolicy(RemovalPolicy.RETAIN);
    trailLogs.policy?.applyRemovalPolicy(RemovalPolicy.RETAIN);
  }
}
