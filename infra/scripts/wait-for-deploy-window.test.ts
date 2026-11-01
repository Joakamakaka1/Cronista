import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('wait-for-deploy-window', () => {
  it('runs with no dependencies installed: the schedule it imports by path imports nothing', () => {
    const schedule = readFileSync(
      new URL('../../packages/core/src/schedule.ts', import.meta.url),
      'utf8',
    );
    expect(schedule).not.toMatch(/^\s*import\b|\bfrom\s+['"]|\bimport\(/m);
  });
});
