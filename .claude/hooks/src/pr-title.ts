/**
 * CI check (`pr-title` job): rejects pull request titles outside the commit convention.
 * The title arrives in the `PR_TITLE` environment variable, never as shell-interpolated text.
 */
import { MAX_PR_TITLE_LENGTH, validatePullRequestTitle } from './conventions.ts';

const title = process.env.PR_TITLE;
if (title === undefined) throw new Error('PR_TITLE is not set');

const problems = validatePullRequestTitle(title);

if (problems.length > 0) {
  process.stderr.write(
    `pr-title: "${title}"\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n` +
      `Format: "<emoji> <type>(<scope>): <description>", at most ${MAX_PR_TITLE_LENGTH} characters.\n`,
  );
  process.exitCode = 1;
}
