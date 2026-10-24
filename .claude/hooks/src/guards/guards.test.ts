import { describe, expect, it } from 'vitest';
import { checkDeployWindow } from './deploy-window.ts';
import { checkGit } from './git.ts';
import { checkProtectedCommand, checkProtectedPath } from './protected-files.ts';
import { checkSecretPaths, checkSecretsInCommand } from './secrets.ts';

describe('secrets', () => {
  it.each([
    'C:\\Users\\me\\.secrets\\cronista\\.env',
    '/repo/.env',
    '/repo/.env.local',
    'C:\\Users\\me\\.claude\\.credentials.json',
    '/repo/certs/server.pem',
    '/repo/prod.dump',
    '**/.env*',
  ])('blocks the path %s', (path) => {
    expect(checkSecretPaths([path])?.decision).toBe('deny');
  });

  it.each(['/repo/.gitignore', '/repo/packages/core/src/env.ts', '/repo/docs/desarrollo.md'])(
    'allows the path %s',
    (path) => {
      expect(checkSecretPaths([path])).toBeUndefined();
    },
  );

  it.each([
    'cat .env',
    'Get-Content $env:USERPROFILE\\.secrets\\cronista\\.env',
    'node --env-file=.env script.ts',
    'printenv',
    'Get-ChildItem env:',
    'echo $env:ANTHROPIC_API_KEY',
    'echo $VOYAGE_API_KEY',
    'aws ssm get-parameter --name /cronista/prod/x --with-decryption',
    'gh auth token',
    'printenv ANTHROPIC_API_KEY',
    'cat "$CRONISTA_ENV_FILE"',
    'node -p process.env',
    "[Environment]::GetEnvironmentVariable('VOYAGE_API_KEY')",
  ])('blocks the command %s', (command) => {
    expect(checkSecretsInCommand(command)?.decision).toBe('deny');
  });

  it.each([
    'pnpm check',
    'git status',
    'cat .gitignore',
    'aws ssm describe-parameters',
    'echo $PATH',
  ])('allows the command %s', (command) => {
    expect(checkSecretsInCommand(command)).toBeUndefined();
  });
});

describe('git', () => {
  it.each([
    ['git commit --no-verify -m "x"', 'feature/CR-1'],
    ['git commit -n -m "x"', 'feature/CR-1'],
    ['git push --force', 'feature/CR-1'],
    ['git push -f origin feature/CR-1', 'feature/CR-1'],
    ['git push origin +feature/CR-1', 'feature/CR-1'],
    ['git push origin master', 'feature/CR-1'],
    ['git push origin HEAD:master', 'feature/CR-1'],
    ['git push', 'master'],
    ['git add . && git commit -m "x"', 'master'],
    ['git reset --hard origin/master', 'feature/CR-1'],
    ['git -C ../Cronista reset --hard origin/master', 'feature/CR-1'],
    ['git -c core.hooksPath=x push -f', 'feature/CR-1'],
    ['git -C "../my repo" push --force', 'feature/CR-1'],
    ["git -C 'C:\\My Repo' reset --hard", 'feature/CR-1'],
    ['git commit -nm "x"', 'feature/CR-1'],
    ['git -c core.hooksPath=NUL commit -m "x"', 'feature/CR-1'],
    ['git config core.hooksPath /dev/null', 'feature/CR-1'],
    ['git push origin HEAD:refs/heads/master', 'feature/CR-1'],
    ['git push --force-if-includes', 'feature/CR-1'],
    ['git checkout -b my-feature', 'master'],
    ['git switch -c feature/CR-1-memory', 'master'],
    ['git branch -m chore/agent-setup', 'chore/CR-1'],
    ['git worktree add ../wt -b feat/x master', 'master'],
  ])('blocks %s on %s', (command, branch) => {
    expect(checkGit(command, branch)?.decision).toBe('deny');
  });

  it.each([
    ['git push -u origin feature/CR-1', 'feature/CR-1'],
    ['git commit -m "✨ feat: add x"', 'feature/CR-1'],
    ['git checkout -b feature/CR-12', 'master'],
    ['git worktree add ../wt -b chore/CR-1 master', 'master'],
    ['git branch -d chore/CR-1', 'master'],
    ['git branch --show-current', 'master'],
    ['git status', 'master'],
    ['git pull', 'master'],
  ])('allows %s on %s', (command, branch) => {
    expect(checkGit(command, branch)).toBeUndefined();
  });
});

describe('deploy window', () => {
  const frozen = new Date('2026-10-24T21:00:00Z'); // 23:00 in Madrid (summer time)
  const open = new Date('2026-10-24T10:00:00Z');

  it('blocks deploys during the freeze', () => {
    expect(checkDeployWindow('pnpm cdk deploy --all', frozen)?.decision).toBe('deny');
    expect(checkDeployWindow('supabase db push --workdir packages/db', frozen)?.decision).toBe(
      'deny',
    );
  });

  it('allows deploys outside the freeze and other commands during it', () => {
    expect(checkDeployWindow('pnpm cdk deploy --all', open)).toBeUndefined();
    expect(checkDeployWindow('pnpm cdk diff', frozen)).toBeUndefined();
  });
});

describe('protected files', () => {
  it('asks before editing guard files', () => {
    expect(checkProtectedPath('C:\\repo\\.gitleaks.toml')?.decision).toBe('ask');
    expect(checkProtectedPath('/repo/.gitleaksignore')?.decision).toBe('ask');
    expect(checkProtectedPath('/repo/.claude/settings.json')?.decision).toBe('ask');
    expect(checkProtectedPath('/repo/.claude/hooks/src/stop.ts')?.decision).toBe('ask');
    expect(checkProtectedPath('/repo/.github/workflows/ci.yml')?.decision).toBe('ask');
    expect(checkProtectedPath('/repo/.claude/rules/workflow.md')).toBeUndefined();
  });

  it('asks before shell writes to guard files but not reads', () => {
    expect(checkProtectedCommand("sed -i 's/a/b/' .gitleaks.toml")?.decision).toBe('ask');
    expect(checkProtectedCommand('Set-Content .githooks/pre-commit "x"')?.decision).toBe('ask');
    expect(checkProtectedCommand('cat .gitleaks.toml')).toBeUndefined();
    expect(checkProtectedCommand('cat .claude/settings.json 2>&1')).toBeUndefined();
  });
});
