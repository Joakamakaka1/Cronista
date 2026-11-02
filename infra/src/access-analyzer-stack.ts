import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnAnalyzer } from 'aws-cdk-lib/aws-accessanalyzer';
import {
  EventBus,
  EventField,
  type EventPattern,
  Rule,
  RuleTargetInput,
} from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

import { alertsTopicIn } from './alerts-topic.ts';
import { ownerOnlySynthesizer } from './owner-only-synthesizer.ts';

/**
 * Name of the rule that carries Access Analyzer findings in every region. Fixed, so that the alerts
 * topic policy and the CloudFormation execution policy can name it without a reference.
 */
export const accessAnalyzerFindingsRuleName = 'cronista-access-analyzer-findings';

/** Name of the role that forwards findings to the alerts region, for the same reason. */
export const accessAnalyzerForwarderRoleName = 'cronista-access-analyzer-forwarder';

/**
 * The EventBridge events of an account's active Access Analyzer findings: new ones, ones whose
 * details change, and archived or resolved ones that come back.
 *
 * @remarks
 * The account filter keeps another account's genuine findings out if a bus ever accepts its events.
 * Deleting a finding (for example with its analyzer) keeps its status and sets `isDeleted`, so
 * that filter keeps those events from reading as new alerts.
 */
export const activeFindingsOf = (account: string): EventPattern => ({
  source: ['aws.access-analyzer'],
  detailType: ['Access Analyzer Finding'],
  account: [account],
  detail: { status: ['ACTIVE'], isDeleted: [false] },
});

/** Properties of {@link AccessAnalyzerStack}. */
export interface AccessAnalyzerStackProps extends StackProps {
  /** Region of the alerts topic (`CronistaAlerts`). */
  readonly alertsRegion: string;
}

/**
 * IAM Access Analyzer for external access. Analyzers are regional, so the app deploys one in
 * every region it uses.
 *
 * @remarks
 * Findings reach EventBridge only in their own region, and a rule cannot target an SNS topic in
 * another one: outside the alerts region, a rule forwards them to that region's default bus, and in
 * the alerts region a rule of the same name publishes them to the topic.
 *
 * It deploys with the CLI credentials of the owner's machine, like `CronistaThreatDetection-*`:
 * the CloudFormation execution policy denies every deploy deleting the analyzer, changing its
 * archive rules and findings, or changing the rule and role named above. Each analyzer was imported
 * into its stack, not created (see "Access Analyzer" in `docs/development.md`).
 */
export class AccessAnalyzerStack extends Stack {
  constructor(scope: Construct, id: string, props: AccessAnalyzerStackProps) {
    super(scope, id, {
      ...props,
      synthesizer: ownerOnlySynthesizer(),
    });
    // A region allows one account analyzer, CloudFormation creates a replacement first, and the
    // import maps this logical ID: keep both its ID and its properties.
    new CfnAnalyzer(this, 'ExternalAccess', { type: 'ACCOUNT' }).applyRemovalPolicy(
      RemovalPolicy.RETAIN,
    );

    if (props.alertsRegion === this.region) {
      const alerts = alertsTopicIn(this);
      const findingRegion = EventField.fromPath('$.detail.region');
      new Rule(this, 'Findings', {
        ruleName: accessAnalyzerFindingsRuleName,
        eventPattern: activeFindingsOf(this.account),
        // The SnsTopic target would add a statement to the topic policy of the other stack, which
        // already accepts this rule by name.
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
      return;
    }
    const alertsBus = EventBus.fromEventBusArn(
      this,
      'AlertsBus',
      this.formatArn({
        service: 'events',
        region: props.alertsRegion,
        resource: 'event-bus',
        resourceName: 'default',
      }),
    );
    // The trust cannot name the rule's ARN: the rule already references the role.
    const forwarder = new Role(this, 'ForwardFindingsRole', {
      roleName: accessAnalyzerForwarderRoleName,
      assumedBy: new ServicePrincipal('events.amazonaws.com').withConditions({
        StringEquals: { 'aws:SourceAccount': this.account },
      }),
    });
    new Rule(this, 'ForwardFindings', {
      ruleName: accessAnalyzerFindingsRuleName,
      eventPattern: activeFindingsOf(this.account),
      targets: [new EventBusTarget(alertsBus, { role: forwarder })],
    });
  }
}
