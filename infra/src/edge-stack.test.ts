import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CachePolicy, OriginRequestPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { beforeAll, describe, expect, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { DomainStack } from './domain-stack.ts';
import { EdgeStack } from './edge-stack.ts';
import { WebAclStack } from './web-acl-stack.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

let edge: Template;
let webAcl: Template;
let distributionLogicalId: string | undefined;

beforeAll(() => {
  // Same context as the real app, so the tests synthesize what gets deployed.
  const app = new App({ context: cdkConfig.context });
  const webAclStack = new WebAclStack(app, 'WebAcl', {
    env: { account, region: 'us-east-1' },
    crossRegionReferences: true,
  });
  const domainStack = new DomainStack(app, 'Domain', {
    env: { account, region: 'us-east-1' },
    crossRegionReferences: true,
  });
  const edgeStack = new EdgeStack(app, 'Edge', {
    env: { account, region: 'eu-west-1' },
    crossRegionReferences: true,
    webAclArn: webAclStack.webAclArn,
    hostedZone: domainStack.hostedZone,
    certificate: domainStack.certificate,
  });
  webAcl = Template.fromStack(webAclStack);
  edge = Template.fromStack(edgeStack);
  [distributionLogicalId] = Object.keys(edge.findResources('AWS::CloudFront::Distribution'));
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

  it('keeps no request samples, which would store session tokens', () => {
    expect(JSON.stringify(webAcl.toJSON())).not.toContain('"SampledRequestsEnabled":true');
  });

  it('uses no rule groups of our own, which the free plan rejects', () => {
    expect(JSON.stringify(webAcl.toJSON())).not.toContain('RuleGroupReferenceStatement');
  });
});

describe('EdgeStack', () => {
  it('bounds the function role with the CDK execution policy', () => {
    edge.hasResourceProperties('AWS::IAM::Role', {
      PermissionsBoundary: {
        'Fn::Join': [
          '',
          ['arn:', { Ref: 'AWS::Partition' }, `:iam::${account}:policy/cronista-cfn-execution`],
        ],
      },
    });
  });

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

  it.each([
    { Action: 'lambda:InvokeFunctionUrl' },
    { Action: 'lambda:InvokeFunction', InvokedViaFunctionUrl: true },
  ])('grants $Action only to this distribution', (permission) => {
    edge.hasResourceProperties('AWS::Lambda::Permission', {
      ...permission,
      Principal: 'cloudfront.amazonaws.com',
      SourceArn: Match.objectLike({
        'Fn::Join': ['', Match.arrayWith([{ Ref: distributionLogicalId }])],
      }),
    });
  });

  it('refuses plain HTTP, so the session token never travels in clear', () => {
    edge.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'https-only' }),
      }),
    });
  });

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

  it('subscribes the distribution, the web ACL and the zone to the free flat-rate plan', () => {
    edge.hasResourceProperties('AWS::PricingPlanManager::Subscription', {
      PlanFamily: 'CloudFront',
      PlanTier: 'FREE',
      ResourceArns: [
        Match.anyValue(),
        Match.anyValue(),
        { 'Fn::Join': ['', Match.arrayWith([':route53:::hostedzone/'])] },
      ],
    });
  });

  it('serves cronista.jcvstro.dev with the us-east-1 certificate over SNI', () => {
    edge.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['cronista.jcvstro.dev'],
        ViewerCertificate: Match.objectLike({
          AcmCertificateArn: Match.anyValue(),
          SslSupportMethod: 'sni-only',
        }),
      }),
    });
  });

  it.each(['A', 'AAAA'])('points the domain at the distribution with an %s alias', (type) => {
    edge.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'cronista.jcvstro.dev.',
      Type: type,
      AliasTarget: Match.objectLike({
        DNSName: { 'Fn::GetAtt': [distributionLogicalId, 'DomainName'] },
      }),
    });
  });
});
