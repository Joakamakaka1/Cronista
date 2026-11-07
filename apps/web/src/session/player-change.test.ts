import { describe, expect, it } from 'vitest';

import { isPlayerChange } from './player-change.ts';

describe('isPlayerChange', () => {
  it('keeps the cache when the same player refreshes their token', () => {
    expect(isPlayerChange('player-a', 'player-a')).toBe(false);
  });

  it('drops it when another player signs in, in this tab or another', () => {
    expect(isPlayerChange('player-a', 'player-b')).toBe(true);
  });

  it('drops it when the session ends', () => {
    expect(isPlayerChange('player-a', null)).toBe(true);
  });

  it('drops it on the first sign-in, so nothing from before it is shown', () => {
    expect(isPlayerChange(null, 'player-a')).toBe(true);
  });

  it('keeps it while staying signed out', () => {
    expect(isPlayerChange(null, null)).toBe(false);
  });
});
