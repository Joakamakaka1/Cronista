import {
  CliCredentialsStackSynthesizer,
  type IStackSynthesizer,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import { EventBus, type EventPattern, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { CfnDetector } from 'aws-cdk-lib/aws-guardduty';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';

/**
 * Name of the rule that carries GuardDuty findings in every region. Fixed, so that the alerts
 * topic policy and the CloudFormation execution policy can name it without a reference.
 */
export const guardDutyFindingsRuleName = 'cronista-guardduty-findings';

/** Name of the role that forwards GuardDuty findings to the alerts region, for the same reason. */
export const guardDutyForwarderRoleName = 'cronista-guardduty-forwarder';

/**
 * The EventBridge events of an account's GuardDuty findings of medium severity (4.0) or higher.
 *
 * @remarks
 * GuardDuty sends one when it creates a finding and again whenever the finding recurs, at most
 * once per publishing frequency. Low findings stay in the console.
 */
export const guardDutyFindingsOf = (account: string): EventPattern => ({
  source: ['aws.guardduty'],
  detailType: ['GuardDuty Finding'],
  account: [account],
  detail: { severity: [{ numeric: ['>=', 4] }] },
});

/** Properties of {@link ThreatDetectionStack}. */
export interface ThreatDetectionStackProps extends StackProps {
  /** Region of the stack that turns findings into alerts (`CronistaAccountGuards`). */
  readonly alertsRegion: string;
  /** The alerts topic. Required in the alerts region, and unused in the others. */
  readonly alerts?: ITopic;
}

/**
 * GuardDuty threat detection. Detectors are regional, so the app deploys one in every region it
 * uses, and their findings reach the alerts topic like those of Access Analyzer.
 *
 * @remarks
 * It deploys with the CLI credentials of the owner's machine, like `CronistaGitHubAccess`: the
 * CloudFormation execution policy denies every deploy any change to the detector and to the rules
 * and role named above. In eu-west-1 the detector is imported, not created, so it keeps its
 * findings (see "GuardDuty" in `docs/development.md`).
 */
export class ThreatDetectionStack extends Stack {
  constructor(scope: Construct, id: string, props: ThreatDetectionStackProps) {
    super(scope, id, {
      ...props,
      // CDK types bootstrapQualifier as `string | undefined`, which IStackSynthesizer rejects
      // under exactOptionalPropertyTypes; the object is a plain CLI credentials synthesizer.
      synthesizer: new CliCredentialsStackSynthesizer() as IStackSynthesizer,
    });

    // A region allows one detector, and the import maps this logical ID: keep it.
    const detector = new CfnDetector(this, 'Detector', {
      enable: true,
      // Only how often a recurring finding is sent again; new findings go out at once.
      findingPublishingFrequency: 'SIX_HOURS',
      // The protections bill only for resources they watch, so the ones without any cost nothing
      // and still catch a deploy that creates them. Runtime Monitoring bills per vCPU of an agent.
      features: [
        ...[
          'S3_DATA_EVENTS',
          'EKS_AUDIT_LOGS',
          'EBS_MALWARE_PROTECTION',
          'RDS_LOGIN_EVENTS',
          'LAMBDA_NETWORK_LOGS',
        ].map((name) => ({ name, status: 'ENABLED' })),
        { name: 'RUNTIME_MONITORING', status: 'DISABLED' },
      ],
      tags: [{ key: 'Project', value: 'la-cronica' }],
    });
    // Deleting the stack must not delete the findings with it.
    detector.applyRemovalPolicy(RemovalPolicy.RETAIN);

    const findings = guardDutyFindingsOf(this.account);
    if (props.alertsRegion === this.region) {
      const { alerts } = props;
      if (alerts === undefined) {
        throw new Error('The alerts region needs the alerts topic to publish findings to.');
      }
      new Rule(this, 'Findings', {
        ruleName: guardDutyFindingsRuleName,
        eventPattern: findings,
        // The SnsTopic target would add a statement to the topic policy of the other stack, which
        // already accepts this rule by name.
        targets: [{ bind: () => ({ arn: alerts.topicArn }) }],
      });
      return;
    }

    // Findings reach EventBridge only in their own region, and a rule cannot target an SNS topic
    // in another one: forward them to the alerts region's default bus.
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
      roleName: guardDutyForwarderRoleName,
      assumedBy: new ServicePrincipal('events.amazonaws.com').withConditions({
        StringEquals: { 'aws:SourceAccount': this.account },
      }),
    });
    new Rule(this, 'ForwardFindings', {
      ruleName: guardDutyFindingsRuleName,
      eventPattern: findings,
      targets: [new EventBusTarget(alertsBus, { role: forwarder })],
    });
  }
}
