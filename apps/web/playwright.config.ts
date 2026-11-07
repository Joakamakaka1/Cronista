import { defineConfig, devices } from '@playwright/test';

// The built app under the site's real headers, with the local API harness, on two phones. The tests
// share the local database and the harness's latest day, so they run one at a time.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: 'pnpm preview:harness',
    url: 'http://127.0.0.1:4173/__harness',
    reuseExistingServer: process.env.CI === undefined,
    timeout: 180_000,
  },
});
