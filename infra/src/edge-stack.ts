import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import {
  Architecture,
  Code,
  FunctionUrlAuthType,
  Function as LambdaFunction,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnSubscription } from 'aws-cdk-lib/aws-pricingplanmanager';
import type { Construct } from 'constructs';

/** Props of {@link EdgeStack}. */
export interface EdgeStackProps extends StackProps {
  /** ARN of the CloudFront-scoped web ACL that `WebAclStack` creates in us-east-1. */
  readonly webAclArn: string;
}

// Placeholder origin until the real api Lambda: it reports what reached it, never the token itself.
const helloHandler = `
exports.handler = async (event) => {
  const body = event.body ?? '';
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'hola',
      method: event.requestContext.http.method,
      bodyBytes: Buffer.from(body, event.isBase64Encoded ? 'base64' : 'utf8').length,
      sessionToken: 'x-session-token' in (event.headers ?? {}),
    }),
  };
};
`;

/**
 * The public edge: CloudFront on the free flat-rate plan in front of a private Lambda Function URL.
 *
 * @remarks
 * The Function URL only accepts requests signed by this distribution (OAC). OAC signs with
 * `Authorization`, so clients send the session JWT in `X-Session-Token` and the body hash in
 * `x-amz-content-sha256` on every POST.
 */
export class EdgeStack extends Stack {
  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    const helloFunction = new LambdaFunction(this, 'HelloFunction', {
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      code: Code.fromInline(helloHandler),
      memorySize: 128,
      timeout: Duration.seconds(5),
      logGroup: new LogGroup(this, 'HelloLogs', {
        retention: RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    const helloUrl = helloFunction.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM });

    const distribution = new Distribution(this, 'Distribution', {
      comment: 'Cronista',
      httpVersion: HttpVersion.HTTP2_AND_3,
      webAclId: props.webAclArn,
      defaultBehavior: {
        origin: FunctionUrlOrigin.withOriginAccessControl(helloUrl),
        allowedMethods: AllowedMethods.ALLOW_ALL,
        // A redirect would let the first plain-HTTP request carry the session token in clear.
        viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
        // The free plan only accepts AWS managed policies.
        cachePolicy: CachePolicy.CACHING_DISABLED,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
    });

    const plan = new CfnSubscription(this, 'FlatRatePlan', {
      planFamily: 'CloudFront',
      planTier: 'FREE',
      resourceArns: [distribution.distributionArn, props.webAclArn],
    });

    new CfnOutput(this, 'DistributionDomain', { value: distribution.distributionDomainName });
    new CfnOutput(this, 'HelloFunctionUrl', { value: helloUrl.url });
    new CfnOutput(this, 'PlanStatus', { value: plan.attrStatus });
  }
}
