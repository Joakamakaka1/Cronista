import { ArnFormat, CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { CfnAnomalyMonitor, CfnAnomalySubscription } from 'aws-cdk-lib/aws-ce';
import { EventField, Rule, RuleTargetInput } from 'aws-cdk-lib/aws-events';
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { type ITopic, Topic } from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';

import { activeFindingsOf } from './access-analyzer-stack.ts';
import { alarmOnAny, alarmPeriod } from './alarm.ts';
import { guardDutyFindingsRuleName } from './threat-detection-stack.ts';

// Expected spend is 0-3 USD a month, so the first alert already means something changed.
const monthlyBudgetsInUsd = [5, 10] as const;

const smallestAnomalyInUsd = 1;

/**
 * Account-wide cost and audit guards: budgets, cost anomaly alerts, Access Analyzer finding alerts
 * and the alarm on throttled Lambdas. GuardDuty findings reach the same alerts topic from
 * `CronistaThreatDetection-*`.
 *
 * @remarks
 * Alerts go to an SNS topic. The owner's email subscribes to it once by CLI, so the address never
 * appears in the code, the templates or CI (see "AWS account setup outside the code" in
 * `docs/development.md`). The topic has no KMS key: the AWS managed SNS key cannot be used by
 * Budgets, and a customer key costs 1 USD a month for messages that only carry spend figures and
 * the ARNs a finding names.
 */
export class AccountGuardsStack extends Stack {
  /** The topic of every account alert, which the other stacks' CloudWatch alarms publish to. */
  readonly alerts: ITopic;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // Replacing the topic would drop the email subscription made by hand: keep its logical ID.
    const alerts = new Topic(this, 'CostAlerts', { enforceSSL: true });
    this.alerts = alerts;
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
    alerts.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sns:Publish'],
        principals: [new ServicePrincipal('cloudwatch.amazonaws.com')],
        resources: [alerts.topicArn],
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          // A pattern, not the alarms' ARNs: they live in the stacks that consume this topic, so a
          // reference would be circular. Every stack of the app is named Cronista*.
          ArnLike: {
            'aws:SourceArn': this.formatArn({
              service: 'cloudwatch',
              resource: 'alarm',
              resourceName: 'Cronista*',
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            }),
          },
        },
      }),
    );
    new CfnOutput(this, 'CostAlertsTopicArn', { value: alerts.topicArn });

    // The analyzers of other regions forward their findings to this region's default bus.
    const findingRegion = EventField.fromPath('$.detail.region');
    const findings = new Rule(this, 'AccessAnalyzerFindings', {
      eventPattern: activeFindingsOf(this.account),
      // The SnsTopic target would let any EventBridge rule publish; the topic accepts only this one.
      targets: [
        {
          bind: () => ({
            arn: alerts.topicArn,
            input: RuleTargetInput.fromMultilineText(
              [
                'Access Analyzer: a resource is reachable from outside the account',
                `Resource: ${EventField.fromPath('$.detail.resource')}`,
                `Type: ${EventField.fromPath('$.detail.resourceType')}`,
                `Public: ${EventField.fromPath('$.detail.isPublic')}`,
                `Region: ${findingRegion}`,
                `Console: https://${findingRegion}.console.aws.amazon.com/access-analyzer/home?region=${findingRegion}#/findings`,
              ].join('\n'),
            ),
          }),
        },
      ],
    });
    alerts.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sns:Publish'],
        principals: [new ServicePrincipal('events.amazonaws.com')],
        resources: [alerts.topicArn],
        conditions: {
          ArnEquals: {
            'aws:SourceArn': [
              findings.ruleArn,
              // By name: that rule lives in CronistaThreatDetection, which references this topic.
              this.formatArn({
                service: 'events',
                resource: 'rule',
                resourceName: guardDutyFindingsRuleName,
              }),
            ],
          },
        },
      }),
    );

    // One metric across every Lambda of the region, instead of one per function: the free tier
    // covers 10 alarm metrics and the app's other alarms use 8.
    alarmOnAny(
      this,
      'LambdaThrottles',
      'A Lambda was throttled. Its Throttles metric in the console says which. The kill switch ' +
        'raises this too.',
      LambdaFunction.metricAllThrottles({ period: alarmPeriod, statistic: 'Sum' }),
      alerts,
    );

    const budgetSubscribers = [{ subscriptionType: 'SNS', address: alerts.topicArn }];

    for (const amount of monthlyBudgetsInUsd) {
      const budget = new CfnBudget(this, `MonthlyBudget${amount}Usd`, {
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
      // Budgets rejects an SNS subscriber it cannot publish to yet: wait for the topic policy.
      budget.node.addDependency(alerts);
    }

    // An account allows one services monitor and CloudFormation creates the replacement first,
    // so replacing it takes two deploys (remove, then add): keep its logical ID and properties.
    const monitor = new CfnAnomalyMonitor(this, 'ServiceAnomalies', {
      monitorName: 'cronista-services',
      monitorType: 'DIMENSIONAL',
      monitorDimension: 'SERVICE',
    });
    const anomalyAlerts = new CfnAnomalySubscription(this, 'AnomalyAlerts', {
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
    anomalyAlerts.node.addDependency(alerts);
  }
}
