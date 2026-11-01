import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { environmentSchema as aiApiEnvironment } from '@cronista/ai-api/environment';
import { environmentSchema as coreApiEnvironment } from '@cronista/core-api/environment';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CachePolicy, OriginRequestPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { beforeAll, describe, expect, it } from 'vitest';

import cdkConfig from '../cdk.json' with { type: 'json' };
import { AccountGuardsStack } from './account-guards-stack.ts';
import { DomainStack } from './domain-stack.ts';
import { EdgeStack } from './edge-stack.ts';
import { nagFindings } from './nag-findings.ts';
import { securityHeadersFunctionCode } from './security-headers.ts';
import { WebAclStack } from './web-acl-stack.ts';

// Invented account: the real one never appears in the repo.
const account = '111111111111';

let webAclStack: WebAclStack;
let edgeStack: EdgeStack;
let webAcl: Template;
let edge: Template;
let assemblyDirectory: string;
let distributionLogicalId: string | undefined;

beforeAll(() => {
  // Same context as the real app, so the tests synthesize what gets deployed.
  const app = new App({ context: cdkConfig.context });
  assemblyDirectory = app.outdir;
  webAclStack = new WebAclStack(app, 'WebAcl', {
    env: { account, region: 'us-east-1' },
    crossRegionReferences: true,
  });
  const domainStack = new DomainStack(app, 'Domain', {
    env: { account, region: 'us-east-1' },
    crossRegionReferences: true,
  });
  const guardsStack = new AccountGuardsStack(app, 'Guards', {
    env: { account, region: 'eu-west-1' },
  });
  edgeStack = new EdgeStack(app, 'Edge', {
    env: { account, region: 'eu-west-1' },
    crossRegionReferences: true,
    webAclArn: webAclStack.webAclArn,
    hostedZone: domainStack.hostedZone,
    certificate: domainStack.certificate,
    alerts: guardsStack.alerts,
  });
  webAcl = Template.fromStack(webAclStack);
  edge = Template.fromStack(edgeStack);
  [distributionLogicalId] = Object.keys(edge.findResources('AWS::CloudFront::Distribution'));
});

// -----------------------------------------------------------------------------
// Template helpers
// -----------------------------------------------------------------------------

interface Resource {
  readonly Type: string;
  readonly Properties?: Record<string, unknown>;
  readonly DeletionPolicy?: string;
}

function resources(template: Template, type: string): [string, Resource][] {
  return Object.entries(template.findResources(type) as Record<string, Resource>);
}

// The API Lambdas are told apart by their environment: only ai-api knows the SSM parameter names.
function apiFunctionId(name: 'core-api' | 'ai-api'): string {
  const apis = resources(edge, 'AWS::Lambda::Function').filter(([, fn]) =>
    JSON.stringify(fn.Properties?.Environment).includes('SUPABASE_URL'),
  );
  const match = apis.find(([, fn]) => {
    const readsKeys = JSON.stringify(fn.Properties?.Environment).includes('ANTHROPIC');
    return name === 'ai-api' ? readsKeys : !readsKeys;
  });
  if (match === undefined) throw new Error(`No ${name} function in the template.`);
  return match[0];
}

function functionProperties(id: string): Record<string, unknown> {
  const match = resources(edge, 'AWS::Lambda::Function').find(([logicalId]) => logicalId === id);
  return match?.[1].Properties ?? {};
}

function roleIdOf(functionId: string): string {
  const role = JSON.stringify(functionProperties(functionId).Role);
  const match = /"Fn::GetAtt":\["([^"]+)","Arn"\]/.exec(role);
  if (match?.[1] === undefined) throw new Error(`No role for ${functionId}.`);
  return match[1];
}

function statementsOf(roleId: string): unknown[] {
  return resources(edge, 'AWS::IAM::Policy')
    .filter(([, policy]) => JSON.stringify(policy.Properties?.Roles).includes(`"${roleId}"`))
    .flatMap(([, policy]) => {
      const document = policy.Properties?.PolicyDocument as { Statement: unknown[] };
      return document.Statement;
    });
}

function urlIdOf(functionId: string): string {
  const match = resources(edge, 'AWS::Lambda::Url').find(([, url]) =>
    JSON.stringify(url.Properties?.TargetFunctionArn).includes(`"${functionId}"`),
  );
  if (match === undefined) throw new Error(`No Function URL for ${functionId}.`);
  return match[0];
}

interface DistributionConfig {
  readonly Origins: { readonly Id: string; readonly DomainName: unknown }[];
  readonly DefaultCacheBehavior: Record<string, unknown>;
  readonly CacheBehaviors: Record<string, unknown>[];
}

function distributionConfig(): DistributionConfig {
  const [[, distribution] = ['', { Type: '' }]] = resources(edge, 'AWS::CloudFront::Distribution');
  return distribution.Properties?.DistributionConfig as DistributionConfig;
}

function originIdOf(urlId: string): string | undefined {
  return distributionConfig().Origins.find((origin) =>
    JSON.stringify(origin.DomainName).includes(`"${urlId}"`),
  )?.Id;
}

// -----------------------------------------------------------------------------
// WebAclStack
// -----------------------------------------------------------------------------

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

  it('limits every request per IP with no scope-down, which the free plan rejects', () => {
    webAcl.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: 'RateLimitPerIp',
          Action: { Block: {} },
          Statement: {
            RateBasedStatement: {
              Limit: 300,
              AggregateKeyType: 'IP',
              ScopeDownStatement: Match.absent(),
            },
          },
        }),
      ]),
    });
  });

  it('only counts the body rules that free-text actions trip, and keeps the 8 KB limit blocking', () => {
    webAcl.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: 'AWSManagedRulesCommonRuleSet',
          OverrideAction: { None: {} },
          Statement: {
            ManagedRuleGroupStatement: {
              VendorName: 'AWS',
              Name: 'AWSManagedRulesCommonRuleSet',
              // An exact list: SizeRestrictions_BODY stays out, so oversized bodies stop at the edge.
              RuleActionOverrides: [
                { Name: 'CrossSiteScripting_BODY', ActionToUse: { Count: {} } },
                { Name: 'GenericLFI_BODY', ActionToUse: { Count: {} } },
              ],
            },
          },
        }),
      ]),
    });
  });

  it.each(['AWSManagedRulesKnownBadInputsRuleSet', 'AWSManagedRulesAmazonIpReputationList'])(
    'overrides nothing in %s',
    (name) => {
      webAcl.hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([
          Match.objectLike({
            Name: name,
            Statement: {
              ManagedRuleGroupStatement: Match.objectLike({ RuleActionOverrides: Match.absent() }),
            },
          }),
        ]),
      });
    },
  );

  it('keeps the logical ID of the live web ACL', () => {
    expect(Object.keys(webAcl.findResources('AWS::WAFv2::WebACL'))).toEqual(['WebAcl']);
  });

  it('passes the AWS Solutions checks', () => {
    expect(nagFindings(webAclStack)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// EdgeStack
// -----------------------------------------------------------------------------

describe('EdgeStack', () => {
  it('keeps the logical IDs of the live distribution, records and plan', () => {
    expect(Object.keys(edge.findResources('AWS::CloudFront::Distribution'))).toEqual([
      'Distribution830FAC52',
    ]);
    expect(Object.keys(edge.findResources('AWS::Route53::RecordSet')).sort()).toEqual([
      'AliasIpv4791D4526',
      'AliasIpv66FA36791',
    ]);
    expect(Object.keys(edge.findResources('AWS::PricingPlanManager::Subscription'))).toEqual([
      'FlatRatePlan',
    ]);
  });

  it('bounds every role with the CDK execution policy', () => {
    const roles = resources(edge, 'AWS::IAM::Role');
    expect(roles.length).toBeGreaterThan(0);
    for (const [, role] of roles) {
      expect(role.Properties?.PermissionsBoundary).toEqual({
        'Fn::Join': [
          '',
          ['arn:', { Ref: 'AWS::Partition' }, `:iam::${account}:policy/cronista-cfn-execution`],
        ],
      });
    }
  });

  it('attaches no managed policy to any role', () => {
    for (const [, role] of resources(edge, 'AWS::IAM::Role')) {
      expect(role.Properties?.ManagedPolicyArns).toBeUndefined();
    }
  });

  describe('API Lambdas', () => {
    it.each([
      ['core-api', 5],
      ['ai-api', 2],
    ] as const)('runs %s on Node 24 arm64 with reserved concurrency %i', (name, concurrency) => {
      expect(functionProperties(apiFunctionId(name))).toMatchObject({
        Runtime: 'nodejs24.x',
        Architectures: ['arm64'],
        ReservedConcurrentExecutions: concurrency,
        LoggingConfig: { LogFormat: 'JSON' },
        Environment: {
          Variables: { SUPABASE_URL: 'https://crbkwqrqaogykugxhewy.supabase.co' },
        },
      });
    });

    it('keeps the Function URLs private behind IAM', () => {
      const urls = resources(edge, 'AWS::Lambda::Url');
      expect(urls).toHaveLength(2);
      for (const [, url] of urls) expect(url.Properties?.AuthType).toBe('AWS_IAM');
    });

    it.each([
      { Action: 'lambda:InvokeFunctionUrl' },
      { Action: 'lambda:InvokeFunction', InvokedViaFunctionUrl: true },
    ])('grants $Action only to this distribution', (permission) => {
      const permissions = resources(edge, 'AWS::Lambda::Permission').filter(
        ([, granted]) => granted.Properties?.Action === permission.Action,
      );
      expect(permissions).toHaveLength(2);
      for (const [, granted] of permissions) {
        expect(granted.Properties).toMatchObject({
          ...permission,
          Principal: 'cloudfront.amazonaws.com',
          SourceArn: { 'Fn::Join': ['', expect.arrayContaining([{ Ref: distributionLogicalId }])] },
        });
      }
    });

    it('lets ai-api read exactly its provider keys and the Langfuse public key, and nothing else in SSM', () => {
      const ssm = statementsOf(roleIdOf(apiFunctionId('ai-api'))).filter((statement) =>
        JSON.stringify(statement).includes('ssm:'),
      );
      expect(ssm).toEqual([
        {
          Effect: 'Allow',
          Action: 'ssm:GetParameter',
          Resource: [
            'anthropic/game-api-key',
            'voyage/api-key',
            'langfuse/secret-key',
            'langfuse/public-key',
          ].map((key) => ({
            'Fn::Join': [
              '',
              [
                'arn:',
                { Ref: 'AWS::Partition' },
                `:ssm:eu-west-1:${account}:parameter/cronista/prod/${key}`,
              ],
            ],
          })),
        },
      ]);
    });

    it('gives core-api no access to SSM', () => {
      const statements = statementsOf(roleIdOf(apiFunctionId('core-api')));
      expect(JSON.stringify(statements)).not.toContain('ssm:');
    });

    it('reads the keys through the Parameters and Secrets extension on ai-api only', () => {
      const ai = functionProperties(apiFunctionId('ai-api'));
      const core = functionProperties(apiFunctionId('core-api'));
      expect(JSON.stringify(ai.Layers)).toContain(
        'AWS-Parameters-and-Secrets-Lambda-Extension-Arm64',
      );
      expect(core.Layers).toBeUndefined();
    });

    it.each([
      ['core-api', coreApiEnvironment],
      ['ai-api', aiApiEnvironment],
    ] as const)('gives %s every variable its handler parses at cold start', (name, schema) => {
      const { Variables } = functionProperties(apiFunctionId(name)).Environment as {
        Variables: Record<string, unknown>;
      };
      // The Lambda runtime adds the session token; everything else comes from the stack.
      const parsed = schema.safeParse({ ...Variables, AWS_SESSION_TOKEN: 'set-by-the-runtime' });
      expect(parsed.error?.issues).toBeUndefined();
    });

    it('keeps class names in the minified bundle, so logged error classes stay readable', () => {
      const code = functionProperties(apiFunctionId('ai-api')).Code as { S3Key: string };
      const bundle = readFileSync(
        join(assemblyDirectory, `asset.${code.S3Key.replace('.zip', '')}`, 'index.mjs'),
        'utf8',
      );
      expect(bundle).toContain('"JWKSTimeout"');
    });

    it('keeps their logs for two weeks', () => {
      for (const [, logGroup] of resources(edge, 'AWS::Logs::LogGroup')) {
        expect(logGroup.Properties?.RetentionInDays).toBe(14);
      }
    });
  });

  describe('alarms', () => {
    it.each(['core-api', 'ai-api'] as const)(
      'alerts on every 5xx that the Function URL of %s answers',
      (name) => {
        edge.hasResourceProperties('AWS::CloudWatch::Alarm', {
          Namespace: 'AWS/Lambda',
          MetricName: 'Url5xxCount',
          Dimensions: [{ Name: 'FunctionName', Value: { Ref: apiFunctionId(name) } }],
          Statistic: 'Sum',
          Threshold: 1,
          ComparisonOperator: 'GreaterThanOrEqualToThreshold',
          TreatMissingData: 'notBreaching',
          AlarmActions: [{ 'Fn::GetStackOutput': Match.anyValue() }],
        });
      },
    );

    it('has no other alarm: the free tier covers 10 alarm metrics', () => {
      expect(resources(edge, 'AWS::CloudWatch::Alarm')).toHaveLength(2);
    });
  });

  describe('site bucket', () => {
    it('is private, versioned, encrypted and kept when the stack goes', () => {
      edge.hasResource('AWS::S3::Bucket', {
        DeletionPolicy: 'Retain',
        Properties: Match.objectLike({
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
          VersioningConfiguration: { Status: 'Enabled' },
          BucketEncryption: {
            ServerSideEncryptionConfiguration: [
              { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
            ],
          },
        }),
      });
    });

    it('lets only this distribution read it, and only over TLS', () => {
      const [[, policy] = ['', { Type: '' }]] = resources(edge, 'AWS::S3::BucketPolicy');
      const statements = (policy.Properties?.PolicyDocument as { Statement: unknown[] }).Statement;
      const allows = statements.filter(
        (statement) => (statement as { Effect: string }).Effect === 'Allow',
      );
      expect(allows).toEqual([
        expect.objectContaining({
          Action: 's3:GetObject',
          Principal: { Service: 'cloudfront.amazonaws.com' },
          Condition: {
            StringEquals: {
              'AWS:SourceArn': {
                'Fn::Join': ['', expect.arrayContaining([{ Ref: distributionLogicalId }])],
              },
            },
          },
        }),
      ]);
      expect(statements).toContainEqual(
        expect.objectContaining({
          Effect: 'Deny',
          Condition: { Bool: { 'aws:SecureTransport': 'false' } },
        }),
      );
    });

    it('leaves its files to deploy-web.yml, which finds it through an output', () => {
      edge.resourceCountIs('Custom::CDKBucketDeployment', 0);
      edge.hasOutput('SiteBucketName', { Value: { Ref: Match.stringLikeRegexp('^SiteBucket') } });
    });
  });

  describe('distribution', () => {
    const viewerResponseFunction = [
      { EventType: 'viewer-response', FunctionARN: Match.anyValue() },
    ];

    it('serves the site from S3 by default, redirecting plain HTTP', () => {
      expect(distributionConfig().DefaultCacheBehavior).toMatchObject({
        ViewerProtocolPolicy: 'redirect-to-https',
        CachePolicyId: CachePolicy.CACHING_OPTIMIZED.cachePolicyId,
      });
      edge.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          DefaultRootObject: 'index.html',
          DefaultCacheBehavior: Match.objectLike({ FunctionAssociations: viewerResponseFunction }),
        }),
      });
      edge.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
        OriginAccessControlConfig: Match.objectLike({
          OriginAccessControlOriginType: 's3',
          SigningBehavior: 'always',
          SigningProtocol: 'sigv4',
        }),
      });
    });

    it('routes /api/ai/* to ai-api before /api/* to core-api', () => {
      const behaviors = distributionConfig().CacheBehaviors;
      expect(behaviors.map((behavior) => behavior.PathPattern)).toEqual(['/api/ai/*', '/api/*']);
      expect(behaviors.map((behavior) => behavior.TargetOriginId)).toEqual([
        originIdOf(urlIdOf(apiFunctionId('ai-api'))),
        originIdOf(urlIdOf(apiFunctionId('core-api'))),
      ]);
    });

    it('refuses plain HTTP on the API, so the session token never travels in clear', () => {
      for (const behavior of distributionConfig().CacheBehaviors) {
        expect(behavior).toMatchObject({
          ViewerProtocolPolicy: 'https-only',
          // The free plan only accepts AWS managed policies.
          CachePolicyId: CachePolicy.CACHING_DISABLED.cachePolicyId,
          OriginRequestPolicyId:
            OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId,
          FunctionAssociations: [
            { EventType: 'viewer-response', FunctionARN: expect.anything() as unknown },
          ],
        });
      }
    });

    it('signs every API request with one Lambda origin access control', () => {
      edge.resourcePropertiesCountIs(
        'AWS::CloudFront::OriginAccessControl',
        {
          OriginAccessControlConfig: Match.objectLike({
            OriginAccessControlOriginType: 'lambda',
            SigningBehavior: 'always',
            SigningProtocol: 'sigv4',
          }),
        },
        1,
      );
    });

    it('rewrites no error responses, which would hide API errors behind the site', () => {
      edge.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({ CustomErrorResponses: Match.absent() }),
      });
    });

    it('adds the security headers with a cloudfront-js-2.0 function', () => {
      edge.hasResourceProperties('AWS::CloudFront::Function', {
        AutoPublish: true,
        FunctionCode: securityHeadersFunctionCode,
        FunctionConfig: Match.objectLike({ Runtime: 'cloudfront-js-2.0' }),
      });
    });

    it('serves cronista.jcvstro.dev with the us-east-1 certificate over SNI', () => {
      edge.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          Aliases: ['cronista.jcvstro.dev'],
          WebACLId: Match.anyValue(),
          ViewerCertificate: Match.objectLike({
            AcmCertificateArn: Match.anyValue(),
            MinimumProtocolVersion: 'TLSv1.2_2021',
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
  });

  it('passes the AWS Solutions checks', () => {
    expect(nagFindings(edgeStack)).toEqual([]);
  });
});
