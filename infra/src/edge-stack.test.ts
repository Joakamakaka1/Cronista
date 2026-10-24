import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CachePolicy, OriginRequestPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { beforeAll, describe, expect, it } from 'vitest';

import { EdgeStack } from './edge-stack.ts';
import { WebAclStack } from './web-acl-stack.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

let edge: Template;
let webAcl: Template;

beforeAll(() => {
  const app = new App();
  const webAclStack = new WebAclStack(app, 'WebAcl', {
    env: { account, region: 'us-east-1' },
    crossRegionReferences: true,
  });
  const edgeStack = new EdgeStack(app, 'Edge', {
    env: { account, region: 'eu-west-1' },
    crossRegionReferences: true,
    webAclArn: webAclStack.webAclArn,
  });
  webAcl = Template.fromStack(webAclStack);
  edge = Template.fromStack(edgeStack);
});

describe('WebAclStack', () => {
  it('creates one CloudFront-scoped web ACL within the free plan limit of 5 rules', () => {
    webAcl.resourceCountIs('AWS::WAFv2::WebACL', 1);
    webAcl.hasResourceProperties('AWS::WAFv2::WebACL', {
      Scope: 'CLOUDFRONT',
      // An exact list: adding a rule must be a deliberate change to this test.
      Rules: [
        Match.objectLike({ Name: 'AWSManagedRulesCommonRuleSet' }),
        Match.objectLike({ Name: 'AWSManagedRulesKnownBadInputsRuleSet' }),
        Match.objectLike({ Name: 'AWSManagedRulesAmazonIpReputationList' }),
        Match.objectLike({ Name: 'RateLimitPerIp' }),
      ],
    });
  });

  it('uses no rule groups of our own, which the free plan rejects', () => {
    expect(JSON.stringify(webAcl.toJSON())).not.toContain('RuleGroupReferenceStatement');
  });
});

describe('EdgeStack', () => {
  it('keeps the Function URL private behind IAM', () => {
    edge.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'AWS_IAM' });
  });

  it('signs every origin request with a Lambda origin access control', () => {
    edge.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: 'lambda',
        SigningBehavior: 'always',
        SigningProtocol: 'sigv4',
      }),
    });
  });

  it.each(['lambda:InvokeFunctionUrl', 'lambda:InvokeFunction'])(
    'grants %s only to the distribution',
    (action) => {
      edge.hasResourceProperties('AWS::Lambda::Permission', {
        Action: action,
        Principal: 'cloudfront.amazonaws.com',
        SourceArn: Match.anyValue(),
      });
    },
  );

  it('uses only AWS managed policies, as the free plan requires', () => {
    edge.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        WebACLId: Match.anyValue(),
        DefaultCacheBehavior: Match.objectLike({
          CachePolicyId: CachePolicy.CACHING_DISABLED.cachePolicyId,
          OriginRequestPolicyId:
            OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId,
        }),
      }),
    });
  });

  it('subscribes the distribution and the web ACL to the free flat-rate plan', () => {
    edge.hasResourceProperties('AWS::PricingPlanManager::Subscription', {
      PlanFamily: 'CloudFront',
      PlanTier: 'FREE',
      ResourceArns: [Match.anyValue(), Match.anyValue()],
    });
  });
});
