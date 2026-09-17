/**
 * Waits for the API before any test runs.
 *
 * Playwright's webServer only waits for the web server on port 5173, and Vite
 * answers within a second or two while the API is still compiling. The first
 * test then signs up against a proxy with nothing behind it and fails with a
 * 500 that has nothing to do with the test.
 */
const API_HEALTH = 'http://localhost:4000/api/v1/health/live';
const TIMEOUT_MS = 120_000;

export default async function waitForApi(): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(API_HEALTH);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`The API did not answer ${API_HEALTH} within ${TIMEOUT_MS / 1000}s`);
}
