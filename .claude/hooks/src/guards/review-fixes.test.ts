import { describe, expect, it } from 'vitest';
import { checkGit, checkMerge, commandDirectory } from './git.ts';
import { checkSecretsInCommand } from './secrets.ts';

describe('git: hooks path', () => {
  it.each([
    'git config core.hooksPath',
    'git config --get core.hooksPath',
    'git config core.hooksPath .githooks',
  ])('allows %s', (command) => {
    expect(checkGit(command, 'feature/CR-1')).toBeUndefined();
  });

  it.each([
    'git config --unset core.hooksPath',
    'git config --global core.hooksPath ~/hooks',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=x git commit -m x',
  ])('blocks %s', (command) => {
    expect(checkGit(command, 'feature/CR-1')?.decision).toBe('deny');
  });
});

describe('git: clean', () => {
  it('asks before git clean with force', () => {
    expect(checkGit('git clean -fdx', 'feature/CR-1')?.decision).toBe('ask');
    expect(checkGit('git clean -n', 'feature/CR-1')).toBeUndefined();
  });
});

describe('commandDirectory', () => {
  it.each([
    ['cd ../wt && git commit -m x', '../wt'],
    ['git -C "../my repo" push', '../my repo'],
    ['Set-Location C:\\dev\\wt; git commit -m x', 'C:\\dev\\wt'],
    ['cd "/c/dev/my wt" && git status', '/c/dev/my wt'],
  ])('finds the directory of %s', (command, directory) => {
    expect(commandDirectory(command)).toBe(directory);
  });

  it('returns undefined when the command does not change directory', () => {
    expect(commandDirectory('git status')).toBeUndefined();
  });
});

describe('checkMerge', () => {
  it.each([
    'gh pr merge 4',
    'gh pr merge',
    'gh -R owner/repo pr merge 4 --squash',
    'gh api -X PUT repos/owner/repo/pulls/4/merge',
    `gh api graphql -f query='mutation{mergePullRequest(input:{pullRequestId:"x"}){clientMutationId}}'`,
    `gh api graphql -f query='mutation{enablePullRequestAutoMerge(input:{}){clientMutationId}}'`,
  ])('blocks %s', (command) => {
    expect(checkMerge(command)?.decision).toBe('deny');
  });

  it.each([
    'git commit -m "deny gh pr merge in any form"',
    'gh pr view 4 --json mergeStateStatus',
    'gh pr create --title "🔧 chore(claude): only the user merges"',
  ])('allows %s', (command) => {
    expect(checkMerge(command)).toBeUndefined();
  });
});

describe('secrets: fewer false positives', () => {
  it.each([
    'grep -rn "\\.env" src',
    "rg '.env' docs",
    'PR_TITLE=x node -e "console.log(process.env.PR_TITLE)"',
  ])('allows %s', (command) => {
    expect(checkSecretsInCommand(command)).toBeUndefined();
  });

  it.each([
    'grep KEY .env',
    'cat ".env"',
    'node -e "console.log(process.env)"',
    'node -e "console.log(process.env.ANTHROPIC_API_KEY)"',
    `node -p "process.env['VOYAGE_API_KEY']"`,
  ])('blocks %s', (command) => {
    expect(checkSecretsInCommand(command)?.decision).toBe('deny');
  });
});
