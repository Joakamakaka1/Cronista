import { ArnFormat, CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Topic } from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';

import { accessAnalyzerFindingsRuleName } from './access-analyzer-stack.ts';
import { alertsTopicName } from './alerts-topic.ts';
import { ownerOnlySynthesizer } from './owner-only-synthesizer.ts';
import { guardDutyFindingsRuleName } from './threat-detection-stack.ts';

/**
 * The SNS topic of every account alert: budgets, cost anomalies, the alarms of the other stacks, and
 * the findings of Access Analyzer and GuardDuty.
 *
 * @remarks
 * It deploys with the CLI credentials of the owner's machine, like `CronistaGitHubAccess`: the
 * CloudFormation execution policy denies every deploy any change to the topic except publishing, so a
 * deploy cannot silence the alerts about what it does. The owner's email subscribes once by CLI, so
 * the address never appears in the code, the templates or CI (see "Alert email" in
 * `docs/development.md`). The topic has no KMS key: the AWS managed SNS key cannot be used by Budgets,
 * and a customer key costs 1 USD a month for messages that only carry spend figures and the ARNs a
 * finding names.
 */
export class AlertsStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, { ...props, synthesizer: ownerOnlySynthesizer() });

    const alerts = new Topic(this, 'Alerts', { topicName: alertsTopicName, enforceSSL: true });
    // Replacing or deleting the topic would drop the email subscription made by hand.
    alerts.applyRemovalPolicy(RemovalPolicy.RETAIN);

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
          // A pattern, not the alarms' ARNs: they live in other stacks, and every stack of the app is
          // named Cronista*.
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
    alerts.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sns:Publish'],
        principals: [new ServicePrincipal('events.amazonaws.com')],
        resources: [alerts.topicArn],
        conditions: {
          ArnEquals: {
            'aws:SourceArn': [accessAnalyzerFindingsRuleName, guardDutyFindingsRuleName].map(
              (rule) => this.formatArn({ service: 'events', resource: 'rule', resourceName: rule }),
            ),
          },
        },
      }),
    );

    new CfnOutput(this, 'AlertsTopicArn', { value: alerts.topicArn });
  }
}
