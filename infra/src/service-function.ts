import { fileURLToPath } from 'node:url';

import { ArnFormat, type Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
  Architecture,
  LoggingFormat,
  ParamsAndSecretsLayerVersion,
  ParamsAndSecretsVersions,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

// esbuild runs from the workspace root, where the services, the packages and the lockfile live.
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Props of {@link ServiceFunction}. */
export interface ServiceFunctionProps {
  /** Folder of the service under `services/`, whose `src/index.ts` exports `handler`. */
  readonly service: 'core-api' | 'ai-api' | 'ai-worker' | 'notifier';
  readonly environment?: Readonly<Record<string, string>>;
  /**
   * SSM SecureString parameters the function reads through the Parameters and Secrets extension,
   * under the environment variable that names each one. Its role may read exactly these.
   */
  readonly parameters?: Readonly<Record<string, string>>;
  /** Concurrent executions reserved for, and capped at, this function. */
  readonly reservedConcurrency: number;
  readonly timeout: Duration;
}

/**
 * One of the four Lambdas (ADR-23): Node 24 on arm64, bundled with esbuild, with its own role that
 * only writes to its own log group and reads its own SSM parameters.
 */
export class ServiceFunction extends Construct {
  /** The function, for its triggers: a Function URL, an event source or a schedule. */
  readonly function: NodejsFunction;

  constructor(scope: Construct, id: string, props: ServiceFunctionProps) {
    super(scope, id);

    const role = new Role(this, 'Role', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: `Runs the ${props.service} Lambda`,
    });
    const logGroup = new LogGroup(this, 'Logs', {
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    logGroup.grantWrite(role);

    const parameters = props.parameters ?? {};
    const parameterNames = Object.values(parameters);
    this.function = new NodejsFunction(this, 'Function', {
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
      role,
      logGroup,
      loggingFormat: LoggingFormat.JSON,
      environment: { NODE_OPTIONS: '--enable-source-maps', ...props.environment, ...parameters },
      // keepNames: the logs record error classes, and jose names its errors after their class.
      bundling: { format: OutputFormat.ESM, minify: true, sourceMap: true, keepNames: true },
      ...(parameterNames.length === 0
        ? {}
        : {
            paramsAndSecrets: ParamsAndSecretsLayerVersion.fromVersion(
              ParamsAndSecretsVersions.V1_0_103,
            ),
          }),
    });

    if (parameterNames.length > 0) {
      const stack = Stack.of(this);
      // Only GetParameter: GetParameterHistory would also return old values. The aws/ssm key needs
      // no KMS grant when the parameter is read through SSM.
      role.addToPrincipalPolicy(
        new PolicyStatement({
          actions: ['ssm:GetParameter'],
          resources: parameterNames.map((name) =>
            stack.formatArn({
              service: 'ssm',
              resource: 'parameter',
              resourceName: name.slice(1),
              arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
            }),
          ),
        }),
      );
    }
  }
}
