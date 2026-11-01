import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createSiteCheck } from './site-check.ts';

const siteUrl = 'https://site.example.com';
const page = '<!doctype html><title>Crónica</title>';

function checkWith(reply: (url: string, init?: RequestInit) => Promise<Response>) {
  // The check always passes a string.
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => reply(input as string, init));
  return { check: createSiteCheck({ siteUrl, fetch }), fetch };
}

// What each URL answers when production is healthy.
const healthy = (url: string) => {
  if (url === `${siteUrl}/`) {
    return Promise.resolve(
      new Response(page, {
        status: 200,
        headers: { 'cache-control': 'no-cache', 'content-type': 'text/html' },
      }),
    );
  }
  return Promise.resolve(new Response('{"error":"unauthorized"}', { status: 401 }));
};

describe('createSiteCheck', () => {
  it('reports what the page and both APIs answer', async () => {
    const { check } = checkWith(healthy);

    expect(await check()).toEqual({
      root: {
        status: 200,
        cacheControl: 'no-cache',
        contentType: 'text/html',
        sha256: createHash('sha256').update(page).digest('hex'),
      },
      me: { status: 401 },
      hint: { status: 401 },
    });
  });

  it('asks each API as a client without a session, and never sends a token', async () => {
    const { check, fetch } = checkWith(healthy);

    await check();

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${siteUrl}/`,
      `${siteUrl}/api/me`,
      `${siteUrl}/api/ai/hint`,
    ]);
    const init = fetch.mock.calls.flatMap(([, options]) => JSON.stringify(options)).join();
    expect(init).not.toMatch(/x-session-token|authorization/i);
  });

  it('signs the POST body the way origin access control needs', async () => {
    const { check, fetch } = checkWith(healthy);

    await check();

    const hint = fetch.mock.calls[2]?.[1];
    expect(hint?.method).toBe('POST');
    expect(hint?.body).toBe('{}');
    expect(hint?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-amz-content-sha256': createHash('sha256').update('{}').digest('hex'),
    });
  });

  it('gives every request a timeout that fits within the Lambda timeout', async () => {
    const { check, fetch } = checkWith(healthy);

    await check();

    for (const [, init] of fetch.mock.calls) expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports status 0 for a URL it cannot reach, without failing the others', async () => {
    const { check } = checkWith((url) =>
      url.endsWith('/api/me') ? Promise.reject(new TypeError('fetch failed')) : healthy(url),
    );

    expect(await check()).toMatchObject({
      root: { status: 200 },
      me: { status: 0 },
      hint: { status: 401 },
    });
  });

  it('reports the status alone when the page itself cannot be reached', async () => {
    const { check } = checkWith((url) =>
      url === `${siteUrl}/` ? Promise.reject(new TypeError('fetch failed')) : healthy(url),
    );

    expect((await check()).root).toEqual({ status: 0 });
  });

  it('reports a page that the geo restriction refused with its own status and hash', async () => {
    const { check } = checkWith((url) =>
      url === `${siteUrl}/`
        ? Promise.resolve(new Response('blocked', { status: 403 }))
        : healthy(url),
    );

    expect((await check()).root).toMatchObject({
      status: 403,
      sha256: createHash('sha256').update('blocked').digest('hex'),
    });
  });
});
