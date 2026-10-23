/**
 * Git `commit-msg` hook (called from `.githooks/commit-msg`): rejects subjects outside the convention.
 */
import { readFile } from 'node:fs/promises';
import { COMMIT_EMOJI, validateCommitSubject } from './conventions.ts';

const messageFile = process.argv[2];
if (messageFile === undefined) throw new Error('Usage: commit-msg.ts <message-file>');

const subject =
  (await readFile(messageFile, 'utf8'))
    .split('\n')
    .find((line) => !line.startsWith('#'))
    ?.trim() ?? '';
const problems = validateCommitSubject(subject);

if (problems.length > 0) {
  const types = Object.entries(COMMIT_EMOJI)
    .map(([type, emoji]) => `${emoji} ${type}`)
    .join(', ');
  process.stderr.write(
    `commit-msg: "${subject}"\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n` +
      `Format: "<emoji> <type>(<scope>): <description>", e.g. "✨ feat(narrator): add memory retrieval".\n` +
      `Types: ${types}.\n`,
  );
  process.exitCode = 1;
}
