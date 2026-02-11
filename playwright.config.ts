/**
 * Playwright E2E test configuration.
 *
 * Starts the backend server via tsx and the dashboard via Vite,
 * then runs E2E tests against the dashboard (port 5173) which
 * proxies API requests to the backend (port 3000).
 *
 * @module playwright.config
 */

import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npx tsx packages/server/src/index.ts',
      port: 3000,
      timeout: 30_000,
      reuseExistingServer: !CI,
      env: {
        DATABASE_PATH: ':memory:',
        JWT_SECRET: 'e2e-test-secret-key-minimum-32-chars-long',
        WS_REQUIRE_AUTH: 'false',
        LOG_LEVEL: 'warn',
        SERVER_PORT: '3000',
        SKIP_SEED_ADMIN: 'true',
        RATE_LIMIT_DISABLED: 'true',
      },
    },
    {
      command: 'pnpm dev:dashboard',
      port: 5173,
      timeout: 30_000,
      reuseExistingServer: !CI,
    },
  ],
});
