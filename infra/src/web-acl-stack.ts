import { Stack, type StackProps } from 'aws-cdk-lib';
import { CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';

// AWS managed rule groups count one rule each towards the free plan limit of 5. Each lists the rules
// it only counts: players write free text, which the body XSS and LFI rules mistake for attacks.
// SizeRestrictions_BODY keeps blocking: no valid body reaches its 8 KB.
const managedRuleGroups = [
  {
    name: 'AWSManagedRulesCommonRuleSet',
    countOnly: ['CrossSiteScripting_BODY', 'GenericLFI_BODY'],
  },
  { name: 'AWSManagedRulesKnownBadInputsRuleSet', countOnly: [] },
  { name: 'AWSManagedRulesAmazonIpReputationList', countOnly: [] },
] as const;

// Five players never get close, even with the site's assets counted; a script hammering the API does.
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
      // Samples keep full request headers for hours, session tokens included.
      sampledRequestsEnabled: false,
    });

    const webAcl = new CfnWebACL(this, 'WebAcl', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: visibility('CronistaEdge'),
      rules: [
        ...managedRuleGroups.map(({ name, countOnly }, priority) => ({
          name,
          priority,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name,
              ...(countOnly.length === 0
                ? {}
                : {
                    ruleActionOverrides: countOnly.map((rule) => ({
                      name: rule,
                      actionToUse: { count: {} },
                    })),
                  }),
            },
          },
          visibilityConfig: visibility(name),
        })),
        {
          name: 'RateLimitPerIp',
          priority: managedRuleGroups.length,
          action: { block: {} },
          statement: {
            // Every request counts, the site's assets included: the free plan rejects a scope-down
            // by URI path.
            rateBasedStatement: { limit: requestsPerIpEveryFiveMinutes, aggregateKeyType: 'IP' },
          },
          visibilityConfig: visibility('RateLimitPerIp'),
        },
      ],
    });

    this.webAclArn = webAcl.attrArn;
  }
}
