import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

// The edge's function adds the site's security headers on top; the API sets its own so that its
// responses, errors included, carry them even where that function does not run.
const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
} as const;

/** A Function URL response with a JSON body that no cache keeps and no browser renders as a page. */
export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: { ...jsonHeaders }, body: JSON.stringify(body) };
}
