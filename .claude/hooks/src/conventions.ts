/**
 * Git conventions shared by the Claude Code hooks and the `commit-msg` git hook.
 */

/** Gitmoji that must lead each Conventional Commit type. */
export const COMMIT_EMOJI = {
  feat: '✨',
  fix: '🐛',
  docs: '📝',
  style: '🎨',
  refactor: '♻️',
  perf: '⚡️',
  test: '✅',
  build: '📦️',
  ci: '👷',
  chore: '🔧',
  revert: '⏪️',
} as const;

/** Conventional Commit types accepted in this repo. */
export type CommitType = keyof typeof COMMIT_EMOJI;

/** Commit subjects longer than this are rejected. */
export const MAX_SUBJECT_LENGTH = 72;

/** Branch types; each one maps to the commit type of the same work (`feature` → `feat`). */
export const BRANCH_TYPES = [
  'feature',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;

/** `<type>/CR-<n>`, where CR-n is the Linear issue. */
export const BRANCH_PATTERN = new RegExp(`^(?:${BRANCH_TYPES.join('|')})/CR-[1-9]\\d*$`);

/** Branches that only change through a pull request. */
export const PROTECTED_BRANCHES: readonly string[] = ['master', 'main'];

const SUBJECT_PATTERN = /^(\S+) ([a-z]+)(\([a-z0-9-]+\))?(!)?: (.+)$/u;

/**
 * Checks the first line of a commit message against the repo convention.
 *
 * @returns The list of problems; empty when the subject is valid.
 */
export function validateCommitSubject(subject: string): string[] {
  // Git writes these itself; they never reach master because PRs are squashed
  if (/^(Merge |Revert "|fixup! |squash! |amend! )/.test(subject)) return [];

  // Count what a reader sees: an emoji with a variation selector is one character
  const length = [...new Intl.Segmenter().segment(subject)].length;
  const problems =
    length > MAX_SUBJECT_LENGTH
      ? [`subject is ${length} characters long (max ${MAX_SUBJECT_LENGTH})`]
      : [];

  const match = SUBJECT_PATTERN.exec(subject);
  if (!match) {
    return [...problems, 'expected "<emoji> <type>(<scope>): <description>"'];
  }
  const [, emoji = '', type = '', , , description = ''] = match;

  if (!(type in COMMIT_EMOJI)) {
    problems.push(`unknown type "${type}" (allowed: ${Object.keys(COMMIT_EMOJI).join(', ')})`);
  } else {
    const expected = COMMIT_EMOJI[type as CommitType];
    // The variation selector (U+FE0F) is optional when typing emoji
    if (emoji.replace(/️/g, '') !== expected.replace(/️/g, '')) {
      problems.push(`type "${type}" must start with ${expected}`);
    }
  }
  if (!/^[a-z0-9`]/.test(description)) problems.push('description must start in lower case');
  if (description.endsWith('.')) problems.push('description must not end with a period');
  return problems;
}
