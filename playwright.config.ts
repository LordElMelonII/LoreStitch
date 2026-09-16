import { defineConfig, devices } from '@playwright/test';

/**
 * E2E configuration for the LoreStitch studio shell. The web server boots the
 * Angular dev server (`npm start`) and Playwright waits for it before running
 * the responsiveness suite.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4301',
    // Failure artifacts for flaky-layout diagnosis; retried locally via
    // `--retries` since the local default is 0.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm start -- --port 4301',
    url: 'http://127.0.0.1:4301',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
