import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { THEME_COLORS, THEME_STORAGE_KEY, themeFrom } from './theme.ts';

describe('themeFrom', () => {
  it('opens in dark mode when nothing is stored', () => {
    expect(themeFrom(null)).toBe('dark');
  });

  it('keeps the light mode a player chose', () => {
    expect(themeFrom('light')).toBe('light');
  });

  it('falls back to dark for anything else in storage', () => {
    expect(themeFrom('sepia')).toBe('dark');
    expect(themeFrom('')).toBe('dark');
  });
});

// public/theme.js runs before the app, so it cannot import these: it must repeat them exactly.
describe('the script that applies the theme before first paint', () => {
  const script = readFileSync(new URL('../../public/theme.js', import.meta.url), 'utf8');

  it('reads the same storage key', () => {
    expect(script).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  it('paints the same browser bar colours', () => {
    expect(script).toContain(`'${THEME_COLORS.dark}'`);
    expect(script).toContain(`'${THEME_COLORS.light}'`);
  });
});
