import { defineConfig, devices } from '@playwright/test';

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
    baseURL: 'http://localhost:5173',
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
  // `pnpm dev` starts the API, the worker and the web app together.
  //
  // reuseExistingServer is on in CI too: the workflow starts the same stack and
  // waits for the API's health endpoint first. Waiting on port 5173 alone is not
  // enough, because Vite answers well before the API has compiled, and the first
  // test signs up straight away.
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: process.env.CI ? 180_000 : 60_000,
    cwd: '../..',
  },
});
