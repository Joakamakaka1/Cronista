import type { NarratorTool } from '@cronista/core';
import { z } from 'zod';

/**
 * The most characters one tool result holds, delimiters included: about 4k tokens, so a narrator
 * step stays small and an MCP answer stays far under the 10k tokens where Claude Code warns.
 */
export const MAX_TOOL_RESULT_CHARACTERS = 12_000;

/**
 * A tool defined once: its name, what the model reads about it, its input and its handler. The
 * narrator and the local MCP server both bind the same definition to their own context.
 */
export interface MemoryToolDefinition<Context> {
  readonly name: string;
  readonly description: string;
  /** The JSON Schema the model sees, generated from the Zod schema that validates the input. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** Validates the input and answers as delimited, untrusted data. It never throws. */
  readonly run: (context: Context, input: unknown) => Promise<string>;
}

/** What a handler answers: lines for the model, or why it cannot, said as what to do next. */
export type ToolAnswer = { readonly ok: true; readonly lines: readonly string[] } | ToolProblem;

/** A wrong input or an outage, told to the model as what it should do instead. */
export interface ToolProblem {
  readonly ok: false;
  readonly problem: string;
}

/** A problem to answer with, instead of data. */
export const problem = (text: string): ToolProblem => ({ ok: false, problem: text });

// Everything a tool answers derives from what players wrote: nothing in it can close the tag.
const escaped = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** A value quoted on one line of a result, so that it cannot pass for another line. */
export const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Wraps a tool's lines in its delimiters, cut at a whole line to {@link MAX_TOOL_RESULT_CHARACTERS}. */
export function untrustedResult(tool: string, lines: readonly string[]): string {
  const open = `<datos_herramienta herramienta="${tool}">`;
  const close = '</datos_herramienta>';
  const cut = '(Resultado recortado: pide menos con `limit` o pasa página con `offset`.)';
  const room = MAX_TOOL_RESULT_CHARACTERS - open.length - close.length - cut.length - 3;
  const kept: string[] = [];
  let used = 0;
  for (const line of lines.map(escaped)) {
    if (used + line.length + 1 > room) {
      kept.push(cut);
      break;
    }
    kept.push(line);
    used += line.length + 1;
  }
  return `${open}\n${kept.join('\n')}\n${close}`;
}

/** Turns Zod's issues into one line the model can act on. */
const inputProblem = (error: z.ZodError) =>
  `Entrada no válida: ${error.issues
    .map(({ path, message }) => `${path.length === 0 ? 'entrada' : path.join('.')}: ${message}`)
    .join('; ')}. Corrige esos campos y vuelve a llamar, o sigue sin esta herramienta.`;

/**
 * Defines a tool from its Zod schema and its handler. The schema validates what the model sends, and
 * a handler that fails unexpectedly answers an outage instead of throwing into the narrator's loop.
 */
export function defineTool<Context, Schema extends z.ZodType>(definition: {
  readonly name: string;
  readonly description: string;
  readonly input: Schema;
  readonly handler: (context: Context, input: z.output<Schema>) => Promise<ToolAnswer>;
}): MemoryToolDefinition<Context> {
  // Without the dialect line, which only adds tokens to every request.
  const inputSchema = Object.fromEntries(
    Object.entries(z.toJSONSchema(definition.input, { io: 'input' })).filter(
      ([key]) => key !== '$schema',
    ),
  );
  return {
    name: definition.name,
    description: definition.description,
    inputSchema,
    run: async (context, input) => {
      const parsed = definition.input.safeParse(input);
      let answer: ToolAnswer;
      if (!parsed.success) {
        answer = problem(inputProblem(parsed.error));
      } else {
        try {
          answer = await definition.handler(context, parsed.data);
        } catch (error) {
          // The class only: an error can quote the data it failed on.
          console.warn({
            message: 'memory tool failed',
            tool: definition.name,
            error: error instanceof Error ? error.name : 'unknown',
          });
          answer = problem('La herramienta ha fallado. Sigue con lo que ya sabes.');
        }
      }
      return untrustedResult(definition.name, answer.ok ? answer.lines : [answer.problem]);
    },
  };
}

/** The definitions bound to one context, in their order, as the narrator receives them. */
export function bindMemoryTools<Context>(
  definitions: readonly MemoryToolDefinition<Context>[],
  context: Context,
): NarratorTool[] {
  return definitions.map(({ name, description, inputSchema, run }) => ({
    name,
    description,
    inputSchema,
    run: (input) => run(context, input),
  }));
}
