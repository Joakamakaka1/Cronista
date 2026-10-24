import { Stack, type StackProps } from 'aws-cdk-lib';
import { CfnAnalyzer } from 'aws-cdk-lib/aws-accessanalyzer';
import { EventBus, type EventPattern, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

/**
 * The EventBridge events of an account's active Access Analyzer findings: new ones, ones whose
 * details change, and archived or resolved ones that come back.
 *
 * @remarks
 * The account filter keeps another account's genuine findings out if a bus ever accepts its events.
 */
export const activeFindingsOf = (account: string): EventPattern => ({
  source: ['aws.access-analyzer'],
  detailType: ['Access Analyzer Finding'],
  account: [account],
  detail: { status: ['ACTIVE'] },
});

/** Properties of {@link AccessAnalyzerStack}. */
export interface AccessAnalyzerStackProps extends StackProps {
  /** Region of the stack that turns findings into alerts (`CronistaAccountGuards`). */
  readonly alertsRegion: string;
}

/**
 * IAM Access Analyzer for external access. Analyzers are regional, so the app deploys one in
 * every region it uses.
 *
 * @remarks
 * Findings reach EventBridge only in their own region, and a rule cannot target an SNS topic in
 * another one: outside the alerts region, a rule forwards them to that region's default bus.
 */
export class AccessAnalyzerStack extends Stack {
  constructor(scope: Construct, id: string, props: AccessAnalyzerStackProps) {
    super(scope, id, props);
    // A region allows one account analyzer and CloudFormation creates the replacement first, so
    // replacing it takes two deploys (remove, then add): keep its logical ID and properties.
    new CfnAnalyzer(this, 'ExternalAccess', { type: 'ACCOUNT' });

    if (props.alertsRegion === this.region) {
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
      assumedBy: new ServicePrincipal('events.amazonaws.com').withConditions({
        StringEquals: { 'aws:SourceAccount': this.account },
      }),
    });
    new Rule(this, 'ForwardFindings', {
      eventPattern: activeFindingsOf(this.account),
      targets: [new EventBusTarget(alertsBus, { role: forwarder })],
    });
  }
}
