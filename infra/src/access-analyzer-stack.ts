import {
  CliCredentialsStackSynthesizer,
  type IStackSynthesizer,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
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
 *
 * It deploys with the CLI credentials of the owner's machine, like `CronistaThreatDetection-*`:
 * the CloudFormation execution policy denies every deploy deleting the analyzer or changing its
 * archive rules and findings. Each analyzer was imported into its stack, not created (see "Access
 * Analyzer" in `docs/development.md`).
 */
export class AccessAnalyzerStack extends Stack {
  constructor(scope: Construct, id: string, props: AccessAnalyzerStackProps) {
    super(scope, id, {
      ...props,
      // CDK types bootstrapQualifier as `string | undefined`, which IStackSynthesizer rejects
      // under exactOptionalPropertyTypes; the object is a plain CLI credentials synthesizer.
      synthesizer: new CliCredentialsStackSynthesizer() as IStackSynthesizer,
    });
    // A region allows one account analyzer, CloudFormation creates a replacement first, and the
    // import maps this logical ID: keep both its ID and its properties.
    new CfnAnalyzer(this, 'ExternalAccess', { type: 'ACCOUNT' }).applyRemovalPolicy(
      RemovalPolicy.RETAIN,
    );

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
