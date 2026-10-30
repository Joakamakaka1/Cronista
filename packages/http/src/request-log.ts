import type { APIGatewayProxyStructuredResultV2, LambdaFunctionURLEvent } from 'aws-lambda';

import { jsonResponse } from './response.ts';

/** A Lambda Function URL handler that answers with a structured response. */
export type FunctionUrlHandler = (
  event: LambdaFunctionURLEvent,
) => Promise<APIGatewayProxyStructuredResultV2>;

/**
 * One log line per request. It never holds headers, bodies or the player's id: the logs must stay
 * free of secrets and personal data.
 */
export interface RequestLogEntry {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  /** Name of the unexpected error class, when the handler threw. */
  readonly error?: string;
}

/**
 * Wraps a handler so every request logs one {@link RequestLogEntry}, and an unexpected error becomes
 * a 500 instead of the runtime's default reply.
 */
export function withRequestLog(
  handler: FunctionUrlHandler,
  log: (entry: RequestLogEntry) => void = (entry) => {
    console.log(entry);
  },
): FunctionUrlHandler {
  return async (event) => {
    const startedAt = performance.now();
    const request = { method: event.requestContext.http.method, path: event.rawPath };
    try {
      const response = await handler(event);
      log({ ...request, status: response.statusCode ?? 200, durationMs: elapsed(startedAt) });
      return response;
    } catch (error) {
      const name = error instanceof Error ? error.name : 'unknown';
      log({ ...request, status: 500, durationMs: elapsed(startedAt), error: name });
      return jsonResponse(500, { error: 'internal' });
    }
  };
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
