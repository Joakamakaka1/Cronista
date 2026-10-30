import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { securityHeadersFunctionCode } from './security-headers.ts';

type Headers = Record<string, { value: string }>;

// Runs the function code as CloudFront would, on a viewer-response event, and returns what it sends.
function runFunction(statusCode: number, headers: Headers) {
  const handler: unknown = runInNewContext(`${securityHeadersFunctionCode}\nhandler;`, {});
  if (typeof handler !== 'function') throw new Error('The function code defines no handler.');
  const response = { statusCode, headers: { ...headers } };
  const event = {
    version: '1.0',
    context: { eventType: 'viewer-response' },
    request: {},
    response,
  };
  const returned: unknown = Reflect.apply(handler, undefined, [event]);
  expect(returned).toBe(response);
  return response;
}

function header(headers: Headers, name: string): string | undefined {
  return headers[name]?.value;
}

describe('securityHeadersFunctionCode', () => {
  const { statusCode, headers } = runFunction(200, {
    'content-type': { value: 'text/html' },
  });

  it('allows only same-origin scripts, styles, images and requests, and no framing', () => {
    const policy = header(headers, 'content-security-policy') ?? '';
    const directives = new Map(
      policy.split(';').map((directive) => {
        const [name = '', ...sources] = directive.trim().split(/\s+/);
        return [name, sources.join(' ')];
      }),
    );
    expect(directives.get('default-src')).toBe("'none'");
    for (const name of ['script-src', 'style-src', 'img-src', 'connect-src']) {
      expect(directives.get(name)).toBe("'self'");
    }
    expect(directives.get('frame-ancestors')).toBe("'none'");
    expect(directives.get('base-uri')).toBe("'none'");
    expect(directives.get('form-action')).toBe("'none'");
  });

  it('pins HTTPS for two years, subdomains included', () => {
    expect(header(headers, 'strict-transport-security')).toBe(
      'max-age=63072000; includeSubDomains',
    );
  });

  it('adds the other hardening headers', () => {
    expect(header(headers, 'x-content-type-options')).toBe('nosniff');
    expect(header(headers, 'x-frame-options')).toBe('DENY');
    expect(header(headers, 'referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(header(headers, 'cross-origin-opener-policy')).toBe('same-origin');
    expect(header(headers, 'permissions-policy')).toContain('camera=()');
    expect(header(headers, 'permissions-policy')).toContain('microphone=()');
    expect(header(headers, 'permissions-policy')).toContain('geolocation=()');
  });

  it('leaves the status and the origin headers alone', () => {
    expect(statusCode).toBe(200);
    expect(header(headers, 'content-type')).toBe('text/html');
  });

  it('keeps a stricter policy the API already set on its own response', () => {
    const api = runFunction(401, {
      'content-security-policy': { value: "default-src 'none'; frame-ancestors 'none'" },
    });
    expect(header(api.headers, 'content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(header(api.headers, 'strict-transport-security')).toBeDefined();
  });
});
