import { fileURLToPath } from 'node:url';

import {
  ArnFormat,
  CfnOutput,
  DefaultStackSynthesizer,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  Validations,
} from 'aws-cdk-lib';
import type { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  AllowedMethods,
  type BehaviorOptions,
  CachePolicy,
  Distribution,
  FunctionCode,
  FunctionEventType,
  Function as CloudFrontFunction,
  FunctionRuntime,
  FunctionUrlOriginAccessControl,
  HttpVersion,
  OriginRequestPolicy,
  S3OriginAccessControl,
  Signing,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
  type IFunctionUrl,
  ParamsAndSecretsLayerVersion,
  ParamsAndSecretsVersions,
} from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnSubscription } from 'aws-cdk-lib/aws-pricingplanmanager';
import { AaaaRecord, ARecord, type IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  CfnBucket,
  type IBucket,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';

import { ApiFunction } from './api-function.ts';
import { aiProviderKeyParameters, supabaseUrl } from './config.ts';
import { securityHeadersFunctionCode } from './security-headers.ts';

/** Props of {@link EdgeStack}. */
export interface EdgeStackProps extends StackProps {
  /** ARN of the CloudFront-scoped web ACL that `WebAclStack` creates in us-east-1. */
  readonly webAclArn: string;

  /** The app's zone, from `DomainStack`: the distribution answers on its name. */
  readonly hostedZone: IHostedZone;

  /** Certificate for the zone's name, from `DomainStack` in us-east-1. */
  readonly certificate: ICertificate;
}

// The static site the distribution serves by default.
const siteContent = fileURLToPath(new URL('../../apps/web/placeholder', import.meta.url));

// The flat-rate plan has neither CloudFront nor S3 access logs, so nothing could receive them.
const noAccessLogs = 'The CloudFront flat-rate Free plan offers no access logs.';

/**
 * The public edge: CloudFront on the free flat-rate plan, serving the static site from a private S3
 * bucket and the two API Lambdas (`/api/ai/*` → ai-api, `/api/*` → core-api) from private Function
 * URLs.
 *
 * @remarks
 * S3 and the Function URLs only accept requests signed by this distribution (OAC). OAC signs with
 * `Authorization`, so clients send the session JWT in `X-Session-Token` and the body hash in
 * `x-amz-content-sha256` on every POST.
 */
export class EdgeStack extends Stack {
  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    // -------------------------------------------------------------------------
    // API Lambdas
    // -------------------------------------------------------------------------

    const coreApi = new ApiFunction(this, 'CoreApi', {
      service: 'core-api',
      environment: { SUPABASE_URL: supabaseUrl },
      reservedConcurrency: 5,
      timeout: Duration.seconds(10),
    });

    // Two at a time is plenty for five players, and caps what a stuck client can spend on credits.
    const aiApi = new ApiFunction(this, 'AiApi', {
      service: 'ai-api',
      environment: {
        SUPABASE_URL: supabaseUrl,
        ANTHROPIC_API_KEY_PARAMETER: aiProviderKeyParameters.anthropic,
        VOYAGE_API_KEY_PARAMETER: aiProviderKeyParameters.voyage,
        LANGFUSE_SECRET_KEY_PARAMETER: aiProviderKeyParameters.langfuse,
      },
      reservedConcurrency: 2,
      timeout: Duration.seconds(20),
      paramsAndSecrets: ParamsAndSecretsLayerVersion.fromVersion(ParamsAndSecretsVersions.V1_0_103),
    });
    // Only GetParameter: GetParameterHistory would also return old values. The aws/ssm key needs no
    // KMS grant when the parameter is read through SSM.
    aiApi.role.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: Object.values(aiProviderKeyParameters).map((name) =>
          this.formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: name.slice(1),
            arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
          }),
        ),
      }),
    );

    // -------------------------------------------------------------------------
    // Site bucket
    // -------------------------------------------------------------------------

    const siteBucket = new Bucket(this, 'SiteBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: Duration.days(30),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    Validations.of(siteBucket).acknowledge({ id: 'AwsSolutions-S1', reason: noAccessLogs });
    // CDK types Bucket.isWebsite as `boolean | undefined`, which IBucket rejects under
    // exactOptionalPropertyTypes; the object is the bucket created just above.
    const site = siteBucket as IBucket;

    // -------------------------------------------------------------------------
    // Distribution
    // -------------------------------------------------------------------------

    const securityHeaders = new CloudFrontFunction(this, 'SecurityHeaders', {
      comment: 'Adds the security headers (CSP, HSTS...) to every response',
      code: FunctionCode.fromInline(securityHeadersFunctionCode),
      runtime: FunctionRuntime.JS_2_0,
    });
    const functionAssociations = [
      { function: securityHeaders, eventType: FunctionEventType.VIEWER_RESPONSE },
    ];

    // One access control per origin type, at stack level, so their IDs never depend on the order
    // of the behaviours.
    const apiAccessControl = new FunctionUrlOriginAccessControl(this, 'ApiOriginAccessControl', {
      signing: Signing.SIGV4_ALWAYS,
    });
    const siteAccessControl = new S3OriginAccessControl(this, 'SiteOriginAccessControl', {
      signing: Signing.SIGV4_ALWAYS,
    });

    const apiBehavior = (url: IFunctionUrl): BehaviorOptions => ({
      origin: FunctionUrlOrigin.withOriginAccessControl(url, {
        originAccessControl: apiAccessControl,
      }),
      allowedMethods: AllowedMethods.ALLOW_ALL,
      // A redirect would let the first plain-HTTP request carry the session token in clear.
      viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
      // The free plan only accepts AWS managed policies.
      cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      functionAssociations,
    });

    const distribution = new Distribution(this, 'Distribution', {
      comment: 'Cronista',
      domainNames: [props.hostedZone.zoneName],
      certificate: props.certificate,
      httpVersion: HttpVersion.HTTP2_AND_3,
      webAclId: props.webAclArn,
      defaultRootObject: 'index.html',
      // No errorResponses: they apply to the whole distribution and would replace the API's errors.
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(site, {
          originAccessControl: siteAccessControl,
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        functionAssociations,
      },
      // CloudFront matches in this order, so the narrower pattern comes first.
      additionalBehaviors: {
        '/api/ai/*': apiBehavior(aiApi.url),
        '/api/*': apiBehavior(coreApi.url),
      },
    });
    Validations.of(distribution).acknowledge(
      {
        id: 'AwsSolutions-CFR1',
        reason: 'Five invited players: geo restriction would only lock them out when travelling.',
      },
      { id: 'AwsSolutions-CFR3', reason: noAccessLogs },
    );

    // -------------------------------------------------------------------------
    // Site content
    // -------------------------------------------------------------------------

    const deploymentRole = new Role(this, 'SiteDeploymentRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Copies the static site into its bucket',
    });
    const deploymentLogs = new LogGroup(this, 'SiteDeploymentLogs', {
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    deploymentLogs.grantWrite(deploymentRole);
    new BucketDeployment(this, 'SiteDeployment', {
      sources: [Source.asset(siteContent)],
      destinationBucket: site,
      prune: true,
      // With no-cache, browsers revalidate and CloudFront keeps each object only for the cache
      // policy's 1 s minimum TTL, so a deploy shows at once without invalidating the distribution.
      cacheControl: [CacheControl.noCache()],
      role: deploymentRole,
      logGroup: deploymentLogs,
    });
    acknowledgeSiteDeployment(this, deploymentRole, siteBucket);

    // -------------------------------------------------------------------------
    // Domain and plan
    // -------------------------------------------------------------------------

    const target = RecordTarget.fromAlias(new CloudFrontTarget(distribution));
    new ARecord(this, 'AliasIpv4', { zone: props.hostedZone, target });
    new AaaaRecord(this, 'AliasIpv6', { zone: props.hostedZone, target });

    // The zone's queries are free only while it belongs to the plan.
    const plan = new CfnSubscription(this, 'FlatRatePlan', {
      planFamily: 'CloudFront',
      planTier: 'FREE',
      resourceArns: [distribution.distributionArn, props.webAclArn, props.hostedZone.hostedZoneArn],
    });

    new CfnOutput(this, 'DistributionDomain', { value: distribution.distributionDomainName });
    new CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new CfnOutput(this, 'PlanStatus', { value: plan.attrStatus });
  }
}

// The grants and the runtime of BucketDeployment are fixed by CDK. Its role only runs during deploys.
function acknowledgeSiteDeployment(stack: Stack, role: Role, siteBucket: Bucket): void {
  const reason =
    'BucketDeployment grants these itself: it reads the CDK asset objects, syncs (and prunes) the ' +
    'site bucket.';
  const assetsBucket = `cdk-${DefaultStackSynthesizer.DEFAULT_QUALIFIER}-assets-${stack.account}-${stack.region}`;
  const cfnSiteBucket = siteBucket.node.defaultChild;
  if (!(cfnSiteBucket instanceof CfnBucket)) throw new Error('The site bucket has no CfnBucket.');
  const siteBucketId = stack.getLogicalId(cfnSiteBucket);
  Validations.of(role).acknowledge(
    ...[
      'Action::s3:GetObject*',
      'Action::s3:GetBucket*',
      'Action::s3:List*',
      'Action::s3:DeleteObject*',
      'Action::s3:Abort*',
      `Resource::arn:<AWS::Partition>:s3:::${assetsBucket}/*`,
      `Resource::<${siteBucketId}.Arn>/*`,
    ].map((finding) => ({ id: `AwsSolutions-IAM5[${finding}]`, reason })),
  );

  const handler = stack.node.children.find((child) =>
    child.node.id.startsWith('Custom::CDKBucketDeployment'),
  );
  if (handler === undefined) throw new Error('BucketDeployment created no handler function.');
  Validations.of(handler).acknowledge({
    id: 'AwsSolutions-L1',
    reason:
      'BucketDeployment pins the Python runtime of its handler; CDK upgrades move it forward.',
  });
}
