import {
  CliCredentialsStackSynthesizer,
  type IStackSynthesizer,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import {
  EventBus,
  EventField,
  type EventPattern,
  Rule,
  RuleTargetInput,
} from 'aws-cdk-lib/aws-events';
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
      // Every protection is pinned, so a new detector matches the imported one instead of taking
      // the API defaults. The enabled ones bill only for resources they watch, so those without
      // any cost nothing and still catch a deploy that creates them. Runtime Monitoring bills per
      // vCPU of an agent, and the AI protections per model call.
      features: [
        { name: 'S3_DATA_EVENTS', status: 'ENABLED' },
        { name: 'EKS_AUDIT_LOGS', status: 'ENABLED' },
        { name: 'EBS_MALWARE_PROTECTION', status: 'ENABLED' },
        // Its RDS_DATA_RISK setting is left to the API: CloudFormation does not accept it yet.
        { name: 'RDS_LOGIN_EVENTS', status: 'ENABLED' },
        { name: 'LAMBDA_NETWORK_LOGS', status: 'ENABLED' },
        { name: 'RUNTIME_MONITORING', status: 'DISABLED' },
        { name: 'AI_PROTECTION', status: 'DISABLED' },
        { name: 'AI_ANALYST', status: 'DISABLED' },
      ],
      // The imported detector carries this tag: declaring it keeps a later update from removing it.
      tags: [{ key: 'Project', value: 'la-cronica' }],
    });
    // Deleting the stack must not delete the findings with it.
    detector.applyRemovalPolicy(RemovalPolicy.RETAIN);

    // Findings of medium severity (4.0) or higher; low ones stay in the console. GuardDuty sends an
    // event when it creates a finding and again when it recurs, at most once per frequency above.
    const findings: EventPattern = {
      source: ['aws.guardduty'],
      detailType: ['GuardDuty Finding'],
      account: [this.account],
      detail: { severity: [{ numeric: ['>=', 4] }] },
    };
    if (props.alertsRegion === this.region) {
      const { alerts } = props;
      if (alerts === undefined) {
        throw new Error('The alerts region needs the alerts topic to publish findings to.');
      }
      const region = EventField.fromPath('$.detail.region');
      new Rule(this, 'Findings', {
        ruleName: guardDutyFindingsRuleName,
        eventPattern: findings,
        // The SnsTopic target would add a statement to the topic policy of the other stack, which
        // already accepts this rule by name.
        targets: [
          {
            bind: () => ({
              arn: alerts.topicArn,
              // No description: EventBridge does not escape what it extracts, and free text may
              // hold quotes.
              input: RuleTargetInput.fromMultilineText(
                [
                  `GuardDuty finding: ${EventField.fromPath('$.detail.title')}`,
                  `Severity: ${EventField.fromPath('$.detail.severity')} (4-6.9 medium, 7-8.9 high, 9+ critical)`,
                  `Region: ${region}`,
                  `Resource: ${EventField.fromPath('$.detail.resource.resourceType')}`,
                  `Type: ${EventField.fromPath('$.detail.type')}`,
                  `Console: https://${region}.console.aws.amazon.com/guardduty/home?region=${region}#/findings?macros=current&fId=${EventField.fromPath('$.detail.id')}`,
                ].join('\n'),
              ),
            }),
          },
        ],
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
