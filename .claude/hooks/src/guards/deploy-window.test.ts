import { describe, expect, it, vi } from 'vitest';
import { checkDeployWindow } from './deploy-window.ts';

// If @cronista/core were imported eagerly, a broken core would make every tool call fail
vi.mock('@cronista/core', () => {
  throw new Error('@cronista/core must only load for deploy commands');
});

describe('deploy window: lazy core import', () => {
  it('does not load @cronista/core for other commands', async () => {
    await expect(checkDeployWindow('git status', new Date())).resolves.toBeUndefined();
  });

  it('loads @cronista/core only for deploy commands', async () => {
    await expect(checkDeployWindow('pnpm cdk deploy --all', new Date())).rejects.toThrow();
  });
});
