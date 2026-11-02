import { Stack, type StackProps } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { CfnAnomalyMonitor, CfnAnomalySubscription } from 'aws-cdk-lib/aws-ce';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';

import { alarmOnAny, alarmPeriod } from './alarm.ts';
import { alertsTopicIn } from './alerts-topic.ts';

// Expected spend is 0-3 USD a month, so the first alert already means something changed.
const monthlyBudgetsInUsd = [5, 10] as const;

const smallestAnomalyInUsd = 1;

/**
 * Account-wide cost guards: budgets, cost anomaly alerts and the alarm on throttled Lambdas, which
 * publish to the topic of `CronistaAlerts`.
 */
export class AccountGuardsStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const alerts = alertsTopicIn(this);

    // One metric across every Lambda of the region, instead of one per function: the app's other
    // alarms already use the 10 alarm metrics of the free tier, and each one more costs 0.10 USD a
    // month.
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
      // Budgets rejects an SNS subscriber it cannot publish to, so `CronistaAlerts` deploys first.
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

    // An account allows one services monitor and CloudFormation creates the replacement first,
    // so replacing it takes two deploys (remove, then add): keep its logical ID and properties.
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
  }
}
