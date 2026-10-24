import { Stack, type StackProps } from 'aws-cdk-lib';
import { CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';

// AWS managed rule groups count one rule each towards the free plan limit of 5.
const managedRuleGroups = [
  'AWSManagedRulesCommonRuleSet',
  'AWSManagedRulesKnownBadInputsRuleSet',
  'AWSManagedRulesAmazonIpReputationList',
] as const;

// Five players never get close; a script hammering the API does.
const requestsPerIpEveryFiveMinutes = 300;

/** CloudFront-scoped WAF web ACL, created in us-east-1 because CloudFront only accepts it from there. */
export class WebAclStack extends Stack {
  /** ARN of the web ACL, for the distribution and the flat-rate plan subscription. */
  readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const visibility = (metricName: string): CfnWebACL.VisibilityConfigProperty => ({
      metricName,
      cloudWatchMetricsEnabled: true,
      sampledRequestsEnabled: true,
    });

    const webAcl = new CfnWebACL(this, 'WebAcl', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: visibility('CronistaEdge'),
      rules: [
        ...managedRuleGroups.map((name, priority) => ({
          name,
          priority,
          overrideAction: { none: {} },
          statement: { managedRuleGroupStatement: { vendorName: 'AWS', name } },
          visibilityConfig: visibility(name),
        })),
        {
          name: 'RateLimitPerIp',
          priority: managedRuleGroups.length,
          action: { block: {} },
          statement: {
            rateBasedStatement: { limit: requestsPerIpEveryFiveMinutes, aggregateKeyType: 'IP' },
          },
          visibilityConfig: visibility('RateLimitPerIp'),
        },
      ],
    });

    this.webAclArn = webAcl.attrArn;
  }
}
