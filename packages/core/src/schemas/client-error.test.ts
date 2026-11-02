import { describe, expect, it } from 'vitest';

import { clientErrorSchema } from './client-error.ts';

const report = {
  type: 'TypeError',
  script: '/_app/immutable/chunks/start.Cz-k_3.js',
  line: 12,
  column: 3480,
  release: '0.19.0',
};

const accepts = (candidate: unknown) => clientErrorSchema.safeParse(candidate).success;

describe('clientErrorSchema', () => {
  it('accepts a report with its location', () => {
    expect(clientErrorSchema.parse(report)).toEqual(report);
  });

  it('accepts a report without a location: a rejection may have no stack', () => {
    expect(accepts({ type: 'other', release: '0.19.0' })).toBe(true);
  });

  it.each(['message', 'url', 'page', 'query', 'fragment', 'stack', 'userId'])(
    'refuses the unknown field %s',
    (field) => {
      expect(accepts({ ...report, [field]: 'texto de un jugador' })).toBe(false);
    },
  );

  it.each(['Cannot read properties of undefined', 'PlayerError', '', 'typeerror'])(
    'refuses %j as an error type: only the closed list passes',
    (type) => {
      expect(accepts({ ...report, type })).toBe(false);
    },
  );

  it.each([
    'https://cronista.jcvstro.dev/check.js',
    'check.js',
    '/',
    '/check.js?token=secret',
    '/check.js#access_token=secret',
    '/una frase de un jugador.js',
    '/index.html',
    `/${'a'.repeat(200)}.js`,
  ])('refuses %j as a script path: it is the path of a script and nothing else', (script) => {
    expect(accepts({ ...report, script })).toBe(false);
  });

  it.each([-1, 1.5, 10_000_001, '12'])('refuses %j as a line or a column', (position) => {
    expect(accepts({ ...report, line: position })).toBe(false);
    expect(accepts({ ...report, column: position })).toBe(false);
  });

  it.each(['latest', '1.0', 'v1.0.0', '1.0.0-rc1', '', '1.0.0 de un jugador'])(
    'refuses %j as a release: only a version passes',
    (release) => {
      expect(accepts({ ...report, release })).toBe(false);
    },
  );

  it('refuses a report without a type or a release', () => {
    expect(accepts({ release: '0.19.0' })).toBe(false);
    expect(accepts({ type: 'Error' })).toBe(false);
  });
});
