/**
 * Stop hook: Claude cannot finish with uncommitted changes until `pnpm check` passes on them.
 *
 * @remarks
 * A passing run is remembered by a fingerprint of the working tree, so unchanged work is not
 * checked twice. `stop_hook_active` lets Claude stop after one forced attempt (no loops).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readHookInput, StopInputSchema } from './input.ts';

const input = await readHookInput(StopInputSchema);

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: input.cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

let status = '';
try {
  status = git(['status', '--porcelain']);
} catch {
  // Not a git repository: nothing to verify
}

if (!input.stop_hook_active && status.trim() !== '') {
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const fingerprint = createHash('sha256')
    .update(status)
    .update(git(['diff', 'HEAD']));
  for (const file of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')) {
    if (file !== '') fingerprint.update(file).update(await readFile(join(root, file)));
  }
  const digest = fingerprint.digest('hex');
  const cacheFile = join(root, 'node_modules', '.cache', 'claude-hooks', 'check-passed');
  const lastPassed = await readFile(cacheFile, 'utf8').catch(() => '');

  if (digest !== lastPassed) {
    const result = spawnSync('pnpm check', {
      cwd: root,
      shell: true,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    if (result.status === 0) {
      await mkdir(dirname(cacheFile), { recursive: true });
      await writeFile(cacheFile, digest);
    } else {
      const output = `${result.stdout}\n${result.stderr}`.trim().slice(-4000);
      process.stdout.write(
        JSON.stringify({
          decision: 'block',
          reason:
            '`pnpm check` fails on the uncommitted changes. Fix it before finishing, ' +
            `or tell the user why it cannot pass yet.\n\n${output}`,
        }),
      );
    }
  }
}
