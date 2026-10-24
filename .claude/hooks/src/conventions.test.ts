import { describe, expect, it } from 'vitest';
import { BRANCH_PATTERN, validateCommitSubject, validatePullRequestTitle } from './conventions.ts';

describe('validateCommitSubject', () => {
  it.each([
    '✨ feat(narrator): add hybrid memory retrieval',
    '🐛 fix(api): reject actions after daily close',
    '📝 docs: translate architecture guide',
    '♻ refactor(core)!: split calendar rules',
    '🔧 chore(deps): pin zod to 4.6.7',
    'fixup! ✨ feat(narrator): add memory',
  ])('accepts %s', (subject) => {
    expect(validateCommitSubject(subject)).toEqual([]);
  });

  it.each([
    ['feat(narrator): add memory', 'expected'],
    ['🐛 feat: add memory', 'must start with ✨'],
    ['✨ feature: add memory', 'unknown type'],
    ['✨ feat: Add memory', 'lower case'],
    ['✨ feat: add memory.', 'period'],
    [`✨ feat: ${'a'.repeat(70)}`, 'characters long'],
  ])('rejects %s', (subject, problem) => {
    expect(validateCommitSubject(subject).join('\n')).toContain(problem);
  });
});

describe('validatePullRequestTitle', () => {
  it.each([
    '📝 docs: translate docs to english',
    '👷 ci: bump actions/checkout from 7.0.1 to 7.0.2',
    `✨ feat: ${'a'.repeat(58)}`, // 66 characters
  ])('accepts %s', (title) => {
    expect(validatePullRequestTitle(title)).toEqual([]);
  });

  it.each([
    [`✨ feat: ${'a'.repeat(59)}`, 'characters long'], // 67 characters
    ['Merge branch master into feature/CR-1', 'expected'],
    ['Revert "✨ feat: add memory"', 'expected'],
    ['ci: bump actions/checkout', 'expected'],
    ['✨ feat: Add memory', 'lower case'],
  ])('rejects %s', (title, problem) => {
    expect(validatePullRequestTitle(title).join('\n')).toContain(problem);
  });
});

describe('BRANCH_PATTERN', () => {
  it('accepts <type>/CR-<n>', () => {
    expect(BRANCH_PATTERN.test('feature/CR-12')).toBe(true);
    expect(BRANCH_PATTERN.test('chore/CR-1')).toBe(true);
  });

  it('rejects other shapes', () => {
    for (const name of [
      'feat/CR-1',
      'feature/cr-1',
      'feature/CR-0',
      'feature/CR-1-memory',
      'master',
    ]) {
      expect(BRANCH_PATTERN.test(name)).toBe(false);
    }
  });
});
