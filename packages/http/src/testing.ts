import type { LambdaFunctionURLEvent } from 'aws-lambda';

/** What a test sets on a {@link functionUrlEvent}; everything else gets a neutral value. */
export interface FunctionUrlEventOptions {
  readonly method?: string;
  readonly path?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly isBase64Encoded?: boolean;
}

/**
 * A Lambda Function URL event as CloudFront forwards it, for tests: header names in lower case and
 * the full path, `/api` prefix included.
 */
export function functionUrlEvent(options: FunctionUrlEventOptions = {}): LambdaFunctionURLEvent {
  const method = options.method ?? 'GET';
  const path = options.path ?? '/api/me';
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: { ...options.headers },
    requestContext: {
      accountId: 'anonymous',
      apiId: 'test',
      domainName: 'test.lambda-url.eu-west-1.on.aws',
      domainPrefix: 'test',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '192.0.2.1', userAgent: 'vitest' },
      requestId: 'test-request',
      routeKey: '$default',
      stage: '$default',
      time: '30/Oct/2026:20:00:00 +0000',
      timeEpoch: 1793390400000,
    },
    ...(options.body === undefined ? {} : { body: options.body }),
    isBase64Encoded: options.isBase64Encoded ?? false,
  };
}
