import { defineConfig, devices } from '@playwright/test';
import { API_HEALTH_URL, WEB_URL } from './e2e/stack/stack.mjs';

const reuse = process.env.E2E_REUSE_STACK === '1';

/**
 * The UI gallery: one pass over every screen and popup, capturing screenshots
 * for a human to review. It is not a test suite — nothing here asserts on
 * behaviour that `playwright.config.ts` does not already cover.
 *
 * Kept in its own config so `pnpm test:e2e` and CI stay exactly as they were;
 * the main config ignores `e2e/gallery/**` for the same reason.
 */
export default defineConfig({
  testDir: './e2e/gallery',
  outputDir: '.e2e/gallery/_run',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
    extraHTTPHeaders: { 'x-e2e-test': 'true' },
    // Decoration is off for the whole run: a shot caught mid-transition is
    // noise in a review whose entire purpose is comparing screens.
    reducedMotion: 'reduce',
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    // The smallest screen the app supports: 375 × 667.
    { name: 'mobile', use: { ...devices['iPhone SE'] } },
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
