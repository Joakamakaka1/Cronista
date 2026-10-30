import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

// The edge adds the site's security headers too; these keep error responses covered either way.
const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
};

/** A Function URL response with a JSON body that no cache keeps and no browser renders as a page. */
export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: { ...jsonHeaders }, body: JSON.stringify(body) };
}
