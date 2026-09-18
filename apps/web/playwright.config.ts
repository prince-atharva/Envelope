import { defineConfig, devices } from '@playwright/test';
import { API_HEALTH_URL, WEB_URL } from './e2e/stack/stack.mjs';

/**
 * Browser tests run against their own isolated stack (e2e/stack/stack.mjs):
 * their own API, worker and web app on ports 4100 and 5174, the *_test
 * database, Redis database 2, and file-only email. They never touch the dev
 * server, the dev database or real email, even while `pnpm dev` is running.
 *
 * The stack is built and started fresh for every run, so it always tests the
 * current code. E2E_REUSE_STACK=1 reuses one already running on those ports,
 * for quick repeat runs while writing a test.
 */
const reuse = process.env.E2E_REUSE_STACK === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: {
      'x-e2e-test': 'true',
    },
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-pixel7',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-iphone14',
      use: { ...devices['iPhone 14'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer: [
    {
      command: 'node e2e/stack/start-api.mjs',
      url: API_HEALTH_URL,
      reuseExistingServer: reuse,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'node e2e/stack/start-web.mjs',
      url: WEB_URL,
      reuseExistingServer: reuse,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
