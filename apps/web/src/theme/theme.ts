import { useCallback, useSyncExternalStore } from 'react';

/** The two looks of the app. Dark is the default. */
export type Theme = 'dark' | 'light';

/** Where the player's choice lives on this device. `public/theme.js` reads the same key. */
export const THEME_STORAGE_KEY = 'cronista:tema';

/** The browser bar's colour in each mode: the page's own background. */
export const THEME_COLORS = { dark: '#111014', light: '#efede8' } as const satisfies Record<
  Theme,
  string
>;

/** The theme a stored value names: light only when the player chose it. */
export function themeFrom(stored: string | null): Theme {
  return stored === 'light' ? 'light' : 'dark';
}

// The document is the source of truth: public/theme.js set it before the first paint.
function currentTheme(): Theme {
  return themeFrom(document.documentElement.dataset.theme ?? null);
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Applies a theme to the page and remembers it on this device when storage allows. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private windows can block storage: the choice holds until the page closes.
  }
  for (const listener of listeners) listener();
}

/** The current theme and a setter, shared by every component that shows or changes it. */
export function useTheme(): readonly [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'dark' as const);
  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
  }, []);
  return [theme, setTheme] as const;
}
