import { fileURLToPath } from 'node:url';

import { type Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
  Architecture,
  type FunctionUrl,
  FunctionUrlAuthType,
  LoggingFormat,
  type ParamsAndSecretsLayerVersion,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

// esbuild runs from the workspace root, where the services, the packages and the lockfile live.
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Props of {@link ApiFunction}. */
export interface ApiFunctionProps {
  /** Folder of the service under `services/`, whose `src/index.ts` exports `handler`. */
  readonly service: 'core-api' | 'ai-api';
  readonly environment: Readonly<Record<string, string>>;
  /** Concurrent executions reserved for, and capped at, this function. */
  readonly reservedConcurrency: number;
  readonly timeout: Duration;
  readonly paramsAndSecrets?: ParamsAndSecretsLayerVersion;
}

/**
 * An API Lambda behind CloudFront: Node 24 on arm64, bundled with esbuild, with its own role that
 * only writes to its own log group, and a Function URL that only accepts IAM-signed requests.
 */
export class ApiFunction extends Construct {
  /** The function's role, for the grants its code needs. */
  readonly role: Role;

  /** The Function URL that CloudFront signs requests to through origin access control. */
  readonly url: FunctionUrl;

  constructor(scope: Construct, id: string, props: ApiFunctionProps) {
    super(scope, id);

    this.role = new Role(this, 'Role', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: `Runs the ${props.service} Lambda`,
    });
    const logGroup = new LogGroup(this, 'Logs', {
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    logGroup.grantWrite(this.role);

    const handler = new NodejsFunction(this, 'Function', {
      entry: fileURLToPath(
        new URL(`../../services/${props.service}/src/index.ts`, import.meta.url),
      ),
      handler: 'handler',
      projectRoot: repositoryRoot,
      depsLockFilePath: fileURLToPath(new URL('../../pnpm-lock.yaml', import.meta.url)),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: props.timeout,
      reservedConcurrentExecutions: props.reservedConcurrency,
      role: this.role,
      logGroup,
      loggingFormat: LoggingFormat.JSON,
      environment: { NODE_OPTIONS: '--enable-source-maps', ...props.environment },
      // keepNames: the logs record error classes, and jose names its errors after their class.
      bundling: { format: OutputFormat.ESM, minify: true, sourceMap: true, keepNames: true },
      ...(props.paramsAndSecrets === undefined ? {} : { paramsAndSecrets: props.paramsAndSecrets }),
    });
    this.url = handler.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM });
  }
}
