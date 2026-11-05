import { z } from 'zod';

// The API's structured output rejects or ignores these, so Zod enforces them after the answer.
const inexpressible = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
]);

function withoutInexpressible(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutInexpressible);
  if (typeof node !== 'object' || node === null) return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !inexpressible.has(key))
      .map(([key, value]) => [key, withoutInexpressible(value)]),
  );
}

/**
 * The JSON Schema to send the API for an output schema: its shape, without the ranges and lengths the
 * API cannot express. The Zod schema stays the one that decides whether an answer is valid.
 */
export function toApiSchema(schema: z.ZodType): Record<string, unknown> {
  return withoutInexpressible(z.toJSONSchema(schema)) as Record<string, unknown>;
}
