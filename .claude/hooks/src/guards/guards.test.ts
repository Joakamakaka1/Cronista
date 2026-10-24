import { describe, expect, it } from 'vitest';
import { checkDeployWindow } from './deploy-window.ts';
import { checkGit, commandDirectory } from './git.ts';

describe('git', () => {
  it.each([
    ['git add . && git commit -m "x"', 'master'],
    ['git commit -m "✨ feat: add x"', 'main'],
    ['git -C ../Cronista commit -m "x"', 'master'],
    ['git checkout -b my-feature', 'master'],
    ['git switch -c feature/CR-1-memory', 'master'],
    ['git branch -m chore/agent-setup', 'chore/CR-1'],
    ['git worktree add ../wt -b feat/x master', 'master'],
    ['git -C ../Cronista switch -c wip', 'feature/CR-1'],
  ])('blocks %s on %s', (command, branch) => {
    expect(checkGit(command, branch)?.decision).toBe('deny');
  });

  it.each([
    ['git commit -m "✨ feat: add x"', 'feature/CR-1'],
    ['git commit -m "📝 docs: explain git checkout -b my-branch"', 'feature/CR-1'],
    ['git commit -F - <<EOF\n📝 docs: x\n\ngit switch -c wip\nEOF', 'feature/CR-1'],
    ['git checkout -b feature/CR-12', 'master'],
    ['git worktree add ../wt -b chore/CR-1 master', 'master'],
    ['git branch -d chore/CR-1', 'master'],
    ['git branch --show-current', 'master'],
    ['git status', 'master'],
    ['git pull', 'master'],
    ['git commit -m "x"', undefined],
  ])('allows %s on %s', (command, branch) => {
    expect(checkGit(command, branch)).toBeUndefined();
  });

  it.each([
    ['git status', undefined],
    ['cd ../other && git commit -m "x"', '../other'],
    ['Set-Location "C:\\dev\\x"; git status', 'C:\\dev\\x'],
    ['cd ../a && git -C b status', '../a/b'],
    ['git -C /c/dev/x status', '/c/dev/x'],
  ])('finds the directory of %s', (command, directory) => {
    expect(commandDirectory(command)).toBe(directory);
  });
});

describe('deploy window', () => {
  const frozen = new Date('2026-10-24T21:00:00Z'); // 23:00 in Madrid (summer time)
  const open = new Date('2026-10-24T10:00:00Z');

  it('blocks deploys during the freeze', async () => {
    expect((await checkDeployWindow('pnpm cdk deploy --all', frozen))?.decision).toBe('deny');
    expect(
      (await checkDeployWindow('supabase db push --workdir packages/db', frozen))?.decision,
    ).toBe('deny');
  });

  it('allows deploys outside the freeze and other commands during it', async () => {
    expect(await checkDeployWindow('pnpm cdk deploy --all', open)).toBeUndefined();
    expect(await checkDeployWindow('pnpm cdk diff', frozen)).toBeUndefined();
  });
});
