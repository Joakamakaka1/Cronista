import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { appRoutesFunctionCode } from './app-routes.ts';

// Runs the function code as CloudFront would, on a viewer-request event, and returns the URI it asks
// the origin for.
function originUri(uri: string): string {
  const handler: unknown = runInNewContext(`${appRoutesFunctionCode}\nhandler;`, {});
  if (typeof handler !== 'function') throw new Error('The function code defines no handler.');
  const request = { method: 'GET', uri, querystring: {}, headers: {} };
  const event = { version: '1.0', context: { eventType: 'viewer-request' }, request };
  const returned: unknown = Reflect.apply(handler, undefined, [event]);
  expect(returned).toBe(request);
  return request.uri;
}

describe('appRoutesFunctionCode', () => {
  it("serves the app's page for a route, so a link to a chapter opens directly", () => {
    expect(originUri('/capitulos/2026-11-09')).toBe('/index.html');
    expect(originUri('/capitulos')).toBe('/index.html');
    expect(originUri('/personajes/')).toBe('/index.html');
    expect(originUri('/')).toBe('/index.html');
  });

  it('leaves files alone, so a missing asset is still a 404 and not a page', () => {
    expect(originUri('/assets/index-3f9a1c.js')).toBe('/assets/index-3f9a1c.js');
    expect(originUri('/favicon.svg')).toBe('/favicon.svg');
    expect(originUri('/index.html')).toBe('/index.html');
  });
});
