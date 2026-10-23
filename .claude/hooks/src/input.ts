/**
 * Zod schemas for the JSON that Claude Code sends to each hook on stdin.
 */
import { z } from 'zod';

const ToolInputSchema = z.looseObject({
  command: z.string().optional(),
  file_path: z.string().optional(),
  notebook_path: z.string().optional(),
  path: z.string().optional(),
  pattern: z.string().optional(),
  glob: z.string().optional(),
});

/** Input of PreToolUse: the tool about to run and its arguments. */
export const PreToolUseInputSchema = z.looseObject({
  cwd: z.string(),
  tool_name: z.string(),
  tool_input: ToolInputSchema,
});

/** Input of PostToolUse; only the fields shared with PreToolUse are read. */
export const PostToolUseInputSchema = PreToolUseInputSchema;

/** Input of Stop; `stop_hook_active` is true when a Stop hook already blocked once. */
export const StopInputSchema = z.looseObject({
  cwd: z.string(),
  stop_hook_active: z.boolean().optional(),
});

/** Input of SessionStart. */
export const SessionStartInputSchema = z.looseObject({
  cwd: z.string(),
});

/** Verdict of a guard; `undefined` lets the normal permission flow continue. */
export type Decision = { decision: 'deny' | 'ask'; reason: string } | undefined;

/** Reads the whole stdin and validates it, so a hook never acts on malformed input. */
export async function readHookInput<T>(schema: z.ZodType<T>): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
