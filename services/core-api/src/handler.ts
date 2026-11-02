import { actionSchema, clientErrorSchema } from '@cronista/core';
import {
  authenticate,
  type BodyError,
  type FunctionUrlHandler,
  jsonResponse,
  noContentResponse,
  readJsonBody,
  type RequestLogEntry,
  type Session,
  type SessionVerifier,
  withRequestLog,
} from '@cronista/http';
import type { APIGatewayProxyStructuredResultV2, LambdaFunctionURLEvent } from 'aws-lambda';

/** What the core-api handler depends on, so tests can replace it. */
export interface CoreApiDependencies {
  readonly verifySession: SessionVerifier;
  /** Tells the alarm on client errors that a player's browser reported one. */
  readonly reportClientError: () => void;
  readonly log?: (entry: RequestLogEntry) => void;
}

// The WAF blocks larger bodies at the edge; this keeps the limit when the Lambda is reached anyway.
const maxBodyBytes = 8 * 1024;

type Route = (
  event: LambdaFunctionURLEvent,
  session: Session,
  dependencies: CoreApiDependencies,
) => APIGatewayProxyStructuredResultV2 | Promise<APIGatewayProxyStructuredResultV2>;

const invalidBody = (error: BodyError) =>
  error === 'too_large'
    ? jsonResponse(413, { error: 'too_large' })
    : jsonResponse(400, { error: 'invalid_body' });

const me: Route = (_, session) => jsonResponse(200, { userId: session.userId });

const sendAction: Route = (event) => {
  const action = readJsonBody(event, actionSchema, maxBodyBytes);
  if (!action.ok) return invalidBody(action.error);
  return jsonResponse(501, { error: 'not_implemented' });
};

const reportClientError: Route = (event, _, dependencies) => {
  const report = readJsonBody(event, clientErrorSchema, maxBodyBytes);
  if (!report.ok) return invalidBody(report.error);
  // Only the validated report: the log says what failed, never who it failed for.
  console.error({ message: 'client error', ...report.value });
  dependencies.reportClientError();
  return noContentResponse();
};

// Maps, not object literals: a path or method from the request never reaches Object.prototype.
const routes: ReadonlyMap<string, ReadonlyMap<string, Route>> = new Map([
  ['/api/me', new Map([['GET', me]])],
  ['/api/actions', new Map([['POST', sendAction]])],
  ['/api/client-errors', new Map([['POST', reportClientError]])],
]);

/** Creates the core-api handler: the REST game API at `/api/*`, for signed-in players only. */
export function createHandler(dependencies: CoreApiDependencies): FunctionUrlHandler {
  return withRequestLog(async (event) => {
    const session = await authenticate(event, dependencies.verifySession);
    if (!session.ok) return session.error;

    const methods = routes.get(event.rawPath);
    if (methods === undefined) return jsonResponse(404, { error: 'not_found' });
    const route = methods.get(event.requestContext.http.method);
    if (route === undefined) return jsonResponse(405, { error: 'method_not_allowed' });
    return route(event, session.value, dependencies);
  }, dependencies.log);
}
