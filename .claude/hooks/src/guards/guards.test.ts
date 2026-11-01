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
    ['git checkout -b "my-feature"', 'master'],
    ["git switch -c 'wip'", 'feature/CR-1'],
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
    ['cd ../Cronista-git-wt && git commit -m "x"', '../Cronista-git-wt'],
    ['Set-Location "C:\\dev\\x"; git status', 'C:\\dev\\x'],
    ['cd ../a && git -C b status', '../a/b'],
    ['git -C /c/dev/x status', '/c/dev/x'],
  ])('finds the directory of %s', (command, directory) => {
    expect(commandDirectory(command)).toBe(directory);
  });
});

describe('deploy window', () => {
  const frozen = new Date('2026-10-24T20:00:00Z'); // 22:00 in Madrid (summer time)
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
    expect(await checkDeployWindow('gh run view 123 --log', frozen)).toBeUndefined();
  });

  it.each([
    'aws s3 sync site s3://bucket --delete',
    'gh api -X POST repos/o/r/actions/runs/1/pending_deployments -f state=approved',
    'gh workflow run deploy.yml -f ref=v0.14.0 -f mode=apply',
    'gh workflow run deploy-web.yml',
  ])('blocks %s during the freeze', async (command) => {
    expect((await checkDeployWindow(command, frozen))?.decision).toBe('deny');
  });

  it('blocks deploys overnight and says when they reopen', async () => {
    const monday = new Date('2026-11-02T01:00:00Z'); // 02:00 in Madrid (winter time)
    const verdict = await checkDeployWindow('pnpm cdk deploy --all', monday);
    expect(verdict?.decision).toBe('deny');
    expect(verdict?.reason).toContain('08:30');
    expect((await checkDeployWindow('pnpm cdk deploy', frozen))?.reason).toContain('23:00');
  });
});
