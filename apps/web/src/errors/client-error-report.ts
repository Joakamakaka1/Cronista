import { CLIENT_ERROR_TYPES, type ClientError } from '@cronista/core';

/** A report before the release is added: no free text, only the type and where it happened. */
export type ErrorReport = Omit<ClientError, 'release'>;

/** The fields of a window `error` event that a report reads. */
export interface ErrorEventFields {
  readonly error: unknown;
  readonly filename: string;
  readonly lineno: number;
  readonly colno: number;
}

/**
 * The report for a window `error` event, or `undefined` when it came from another origin (browser
 * extensions) or from a script the browser hides from us.
 */
export function reportFromErrorEvent(
  event: ErrorEventFields,
  origin: string,
): ErrorReport | undefined {
  const script = sameOriginScript(event.filename, origin);
  if (script === undefined) return undefined;
  return { type: errorType(event.error), script, line: event.lineno, column: event.colno };
}

/**
 * The report for an error that only has a stack: a rejected promise or a render failure. With no
 * stack it reports only the type, because a real failure beats an extra alert.
 */
export function reportFromStack(error: unknown, origin: string): ErrorReport | undefined {
  const type = errorType(error);
  // V8 opens the stack with the message, which must not pass for a frame.
  const frames = error instanceof Error ? (error.stack ?? '').replace(error.message, '') : '';
  const frame = /([a-z-]+:\/\/[^\s()]+):(\d+):(\d+)/.exec(frames);
  if (frame === null) return { type };
  const script = sameOriginScript(frame[1] ?? '', origin);
  if (script === undefined) return undefined;
  return { type, script, line: Number(frame[2]), column: Number(frame[3]) };
}

function sameOriginScript(url: string, origin: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin ? parsed.pathname : undefined;
  } catch {
    return undefined;
  }
}

function errorType(error: unknown): ClientError['type'] {
  if (error instanceof DOMException) return 'DOMException';
  if (error instanceof Error) {
    const named = CLIENT_ERROR_TYPES.find((type) => type === error.name);
    if (named !== undefined) return named;
  }
  return 'other';
}
