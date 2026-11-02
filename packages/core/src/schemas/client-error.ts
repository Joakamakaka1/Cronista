import { z } from 'zod';

/** The error types a report can name. Any other error, a custom class included, reports `other`. */
export const CLIENT_ERROR_TYPES = [
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'DOMException',
  'other',
] as const;

// Minified bundles put whole chunks on one line, so a column can be far larger than a line.
const maxPosition = 10_000_000;

/**
 * Body of `POST /api/client-errors`: an uncaught error in a player's browser, with no free text.
 *
 * @remarks
 * It never holds the error's message, which V8 can fill with the data it failed on, or the page's
 * URL, whose fragment holds the access token after signing in. A rejection may have no stack, and
 * then no location either.
 */
export const clientErrorSchema = z.strictObject({
  type: z.enum(CLIENT_ERROR_TYPES),
  script: z
    .string()
    .max(200)
    .regex(/^\/[\w./-]+\.js$/)
    .optional(),
  line: z.int().min(0).max(maxPosition).optional(),
  column: z.int().min(0).max(maxPosition).optional(),
  release: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/),
});

/** A report validated by {@link clientErrorSchema}. */
export type ClientError = z.infer<typeof clientErrorSchema>;
