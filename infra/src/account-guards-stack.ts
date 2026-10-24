import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { CfnAnomalyMonitor, CfnAnomalySubscription } from 'aws-cdk-lib/aws-ce';
import { Trail } from 'aws-cdk-lib/aws-cloudtrail';
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket, BucketEncryption, type IBucket } from 'aws-cdk-lib/aws-s3';
import { Topic } from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';

// Expected spend is 0-3 USD a month, so the first alert already means something changed.
const monthlyBudgetsInUsd = [5, 10] as const;

const smallestAnomalyInUsd = 1;

const trailLogRetention = Duration.days(90);

/**
 * Account-wide cost and audit guards: budgets, cost anomaly alerts and a CloudTrail trail.
 *
 * @remarks
 * Alerts go to an SNS topic. The owner's email subscribes to it once by CLI, so the address never
 * appears in the code, the templates or CI (see "AWS account setup outside the code" in `docs/development.md`). The topic has no KMS key:
 * the AWS managed SNS key cannot be used by Budgets, and a customer key costs 1 USD a month for
 * messages that only carry spend figures.
 */
export class AccountGuardsStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const alerts = new Topic(this, 'CostAlerts', { enforceSSL: true });
    alerts.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sns:Publish'],
        principals: [
          new ServicePrincipal('budgets.amazonaws.com'),
          new ServicePrincipal('costalerts.amazonaws.com'),
        ],
        resources: [alerts.topicArn],
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    );
    new CfnOutput(this, 'CostAlertsTopicArn', { value: alerts.topicArn });
    const budgetSubscribers = [{ subscriptionType: 'SNS', address: alerts.topicArn }];

    for (const amount of monthlyBudgetsInUsd) {
      new CfnBudget(this, `MonthlyBudget${amount}Usd`, {
        budget: {
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount, unit: 'USD' },
        },
        notificationsWithSubscribers: [
          { notificationType: 'ACTUAL', threshold: 80 },
          { notificationType: 'ACTUAL', threshold: 100 },
          { notificationType: 'FORECASTED', threshold: 100 },
        ].map((notification) => ({
          notification: {
            ...notification,
            comparisonOperator: 'GREATER_THAN',
            thresholdType: 'PERCENTAGE',
          },
          subscribers: budgetSubscribers,
        })),
      });
    }

    const monitor = new CfnAnomalyMonitor(this, 'ServiceAnomalies', {
      monitorName: 'cronista-services',
      monitorType: 'DIMENSIONAL',
      monitorDimension: 'SERVICE',
    });
    new CfnAnomalySubscription(this, 'AnomalyAlerts', {
      subscriptionName: 'cronista-anomalies',
      // Immediate alerts only support SNS; email is limited to daily or weekly digests.
      frequency: 'IMMEDIATE',
      monitorArnList: [monitor.attrMonitorArn],
      subscribers: [{ type: 'SNS', address: alerts.topicArn }],
      thresholdExpression: JSON.stringify({
        Dimensions: {
          Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE',
          MatchOptions: ['GREATER_THAN_OR_EQUAL'],
          Values: [String(smallestAnomalyInUsd)],
        },
      }),
    });

    const trailLogs = new Bucket(this, 'TrailLogs', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: trailLogRetention }],
      // Audit logs outlive the stack: deleting it must not delete the evidence.
      removalPolicy: RemovalPolicy.RETAIN,
    });
    new Trail(this, 'ManagementEvents', {
      // CDK types Bucket.isWebsite as `boolean | undefined`, which IBucket rejects under
      // exactOptionalPropertyTypes; the object is the bucket created just above.
      bucket: trailLogs as IBucket,
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
      enableFileValidation: true,
    });
  }
}
