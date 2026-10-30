/**
 * Security headers every response gets at the edge. The free flat-rate plan only accepts AWS managed
 * response headers policies, none of which sets a CSP, so a CloudFront Function adds them.
 */
export const securityHeaders = {
  'content-security-policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
} as const satisfies Readonly<Record<string, string>>;

/**
 * Source of the viewer-response CloudFront Function (`cloudfront-js-2.0`) that adds
 * {@link securityHeaders}. A header the origin already set is kept, so the API's stricter policy on
 * its JSON responses wins over the site's.
 */
export const securityHeadersFunctionCode = `var securityHeaders = ${JSON.stringify(securityHeaders)};

function handler(event) {
  var headers = event.response.headers;
  for (var name in securityHeaders) {
    if (!headers[name]) headers[name] = { value: securityHeaders[name] };
  }
  return event.response;
}`;
