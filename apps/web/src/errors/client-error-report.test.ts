import { describe, expect, it } from 'vitest';

import { reportFromErrorEvent, reportFromStack } from './client-error-report.ts';

const origin = 'https://cronista.example.com';

describe('reportFromErrorEvent', () => {
  it('reports the type and where it happened, never the message', () => {
    const report = reportFromErrorEvent(
      {
        error: new TypeError('No se pudo leer «La llave» de La Farera'),
        filename: `${origin}/assets/index-3f9a1c.js`,
        lineno: 1,
        colno: 4021,
      },
      origin,
    );
    expect(report).toEqual({
      type: 'TypeError',
      script: '/assets/index-3f9a1c.js',
      line: 1,
      column: 4021,
    });
    expect(JSON.stringify(report)).not.toContain('Farera');
  });

  it('ignores scripts from other origins, such as browser extensions', () => {
    expect(
      reportFromErrorEvent(
        {
          error: new Error('x'),
          filename: 'chrome-extension://abc/content.js',
          lineno: 1,
          colno: 1,
        },
        origin,
      ),
    ).toBeUndefined();
    expect(
      reportFromErrorEvent({ error: null, filename: '', lineno: 0, colno: 0 }, origin),
    ).toBeUndefined();
  });

  it('names any custom error class as other', () => {
    class GameError extends Error {
      override name = 'GameError';
    }
    expect(
      reportFromErrorEvent(
        { error: new GameError('x'), filename: `${origin}/assets/a.js`, lineno: 2, colno: 3 },
        origin,
      )?.type,
    ).toBe('other');
  });
});

describe('reportFromStack', () => {
  it('takes the first frame of the stack, after the message', () => {
    const error = new RangeError('stake 99 of https://evil.example.com/x.js:9:9');
    error.stack = `RangeError: ${error.message}\n    at play (${origin}/assets/index-3f9a1c.js:12:34)`;
    expect(reportFromStack(error, origin)).toEqual({
      type: 'RangeError',
      script: '/assets/index-3f9a1c.js',
      line: 12,
      column: 34,
    });
  });

  it('reports only the type when there is no stack', () => {
    expect(reportFromStack('a string', origin)).toEqual({ type: 'other' });
    const error = new Error('x');
    error.stack = '';
    expect(reportFromStack(error, origin)).toEqual({ type: 'Error' });
  });

  it('ignores a stack from another origin', () => {
    const error = new Error('x');
    error.stack = 'Error: x\n    at f (chrome-extension://abc/content.js:1:1)';
    expect(reportFromStack(error, origin)).toBeUndefined();
  });
});
