import {
  CfnOutput,
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
import { FunctionUrlAuthType, type IFunctionUrl } from 'aws-cdk-lib/aws-lambda';
import { CfnSubscription } from 'aws-cdk-lib/aws-pricingplanmanager';
import { AaaaRecord, ARecord, type IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  type IBucket,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';

import { alarmOnAny, alarmPeriod } from './alarm.ts';
import {
  aiProviderKeyParameters,
  langfusePublicKeyParameter,
  langfuseUrl,
  supabaseUrl,
} from './config.ts';
import { securityHeadersFunctionCode } from './security-headers.ts';
import { ServiceFunction } from './service-function.ts';

/** Props of {@link EdgeStack}. */
export interface EdgeStackProps extends StackProps {
  /** ARN of the CloudFront-scoped web ACL that `WebAclStack` creates in us-east-1. */
  readonly webAclArn: string;

  /** The app's zone, from `DomainStack`: the distribution answers on its name. */
  readonly hostedZone: IHostedZone;

  /** Certificate for the zone's name, from `DomainStack` in us-east-1. */
  readonly certificate: ICertificate;

  /** The account alerts topic of `AccountGuardsStack`, in this region, for the alarms. */
  readonly alerts: ITopic;
}

// The flat-rate plan has neither CloudFront nor S3 access logs, so nothing could receive them.
const noAccessLogs = 'The CloudFront flat-rate Free plan offers no access logs.';

/**
 * The public edge: CloudFront on the free flat-rate plan, serving the static site from a private S3
 * bucket and the two API Lambdas (`/api/ai/*` → ai-api, `/api/*` → core-api) from private Function
 * URLs. The site's files are not part of the stack: `deploy-web.yml` syncs them into the bucket.
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

    const coreApi = new ServiceFunction(this, 'CoreApi', {
      service: 'core-api',
      environment: { SUPABASE_URL: supabaseUrl },
      reservedConcurrency: 5,
      timeout: Duration.seconds(10),
    });

    // Two at a time is plenty for five players, and caps what a stuck client can spend on credits.
    const aiApi = new ServiceFunction(this, 'AiApi', {
      service: 'ai-api',
      environment: { SUPABASE_URL: supabaseUrl, LANGFUSE_URL: langfuseUrl },
      parameters: {
        ANTHROPIC_API_KEY_PARAMETER: aiProviderKeyParameters.anthropic,
        VOYAGE_API_KEY_PARAMETER: aiProviderKeyParameters.voyage,
        LANGFUSE_SECRET_KEY_PARAMETER: aiProviderKeyParameters.langfuse,
        LANGFUSE_PUBLIC_KEY_PARAMETER: langfusePublicKeyParameter,
      },
      reservedConcurrency: 2,
      timeout: Duration.seconds(20),
    });

    // CloudFront signs every request to them through origin access control.
    const coreApiUrl = coreApi.function.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM });
    const aiApiUrl = aiApi.function.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM });

    // The URL's 5xx, not the function's Errors: `withRequestLog` turns a throw into a 500, so Errors
    // would miss every failure of a handler.
    alarmOnAny(
      this,
      'CoreApiErrors',
      'core-api answered a 5xx: a function error, a timeout or a handler that threw.',
      coreApi.function.metric('Url5xxCount', { period: alarmPeriod, statistic: 'Sum' }),
      props.alerts,
    );
    alarmOnAny(
      this,
      'AiApiErrors',
      'ai-api answered a 5xx: a function error, a timeout or a handler that threw.',
      aiApi.function.metric('Url5xxCount', { period: alarmPeriod, statistic: 'Sum' }),
      props.alerts,
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
        '/api/ai/*': apiBehavior(aiApiUrl),
        '/api/*': apiBehavior(coreApiUrl),
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
    // `deploy-web.yml` reads it to sync the site.
    new CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new CfnOutput(this, 'PlanStatus', { value: plan.attrStatus });
  }
}
