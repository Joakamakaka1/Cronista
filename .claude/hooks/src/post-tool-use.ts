/**
 * PostToolUse hook for Edit/Write: formats the file with Prettier and reminds Claude to run the evals.
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { format, getFileInfo, resolveConfig } from 'prettier';
import { PostToolUseInputSchema, readHookInput } from './input.ts';

const input = await readHookInput(PostToolUseInputSchema);
const filePath = input.tool_input.file_path;
let root = input.cwd;
try {
  // The session may start in a subdirectory; formatting and ignores work from the repo root
  root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: input.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  // Outside a repository the session directory is the boundary
}
const relativePath = filePath === undefined ? '..' : relative(root, filePath);

// Files outside the repo (e.g. personal config) are not ours to format
if (filePath !== undefined && !relativePath.startsWith('..') && !isAbsolute(relativePath)) {
  const notes: string[] = [];

  try {
    const info = await getFileInfo(filePath, {
      ignorePath: join(root, '.prettierignore'),
      resolveConfig: true,
    });
    if (!info.ignored && info.inferredParser !== null) {
      const source = await readFile(filePath, 'utf8');
      const formatted = await format(source, {
        ...(await resolveConfig(filePath)),
        filepath: filePath,
      });
      if (formatted !== source) await writeFile(filePath, formatted);
    }
  } catch (error) {
    notes.push(`Prettier could not format ${relativePath}: ${String(error)}`);
  }

  if (/^(?:packages[\\/]narrator|evals)[\\/]/.test(relativePath)) {
    notes.push(
      'You changed narrator or eval code: run the evals before finishing and report the results ' +
        '(see .claude/rules/narrator.md).',
    );
  }

  if (notes.length > 0) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n') },
      }),
    );
  }
}
