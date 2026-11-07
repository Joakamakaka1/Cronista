import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';

// A player's stored light or dark choice, as the app reads it before the first paint.
const storedTheme = (theme: 'dark' | 'light') => ({
  cookies: [],
  origins: [{ origin: baseURL, localStorage: [{ name: 'cronista:tema', value: theme }] }],
});

// The built app under the site's real headers, with the local API harness, on two phones and in
// both modes. The tests share the local database and the harness's latest day, so they run one at
// a time.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined,
  reporter: 'list',
  use: {
    baseURL,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium-dark',
      metadata: { theme: 'dark' },
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-chromium-light',
      metadata: { theme: 'light' },
      use: { ...devices['Pixel 7'], storageState: storedTheme('light') },
    },
    {
      name: 'mobile-webkit-dark',
      metadata: { theme: 'dark' },
      use: { ...devices['iPhone 15'] },
    },
    {
      name: 'mobile-webkit-light',
      metadata: { theme: 'light' },
      use: { ...devices['iPhone 15'], storageState: storedTheme('light') },
    },
  ],
  webServer: {
    command: 'pnpm preview:harness',
    url: `${baseURL}/__harness`,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 180_000,
  },
});
