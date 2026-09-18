import { defineConfig, devices } from '@playwright/test';

/**
 * E2E configuration for the LoreStitch studio shell.
 * Boots the Angular dev server and runs tests across desktop and mobile viewports.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  // One retry everywhere: the three-project suite saturates an 8-core dev
  // box (ng serve + browser workers), which starves Playwright's WebKit
  // actionability poll ("waiting for element to be … stable" past a static,
  // fully-rendered page). CI already retried once; local parity keeps a
  // single contention stall from turning the whole run red.
  retries: 1,

  // Prevents CI runners from running out of memory while Angular dev server is running.
  // Locally, cap below the default (cpus/2 = 4): with four workers plus the
  // dev server the WebKit project's actionability checks stall under CPU
  // contention far more often (see the retry note above), so local runs
  // trade a little runtime for stability.
  workers: process.env['CI'] ? 1 : 2,

  // Clean console output locally, plus inspectable HTML artifact on CI
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never' }]]
    : 'list',

  use: {
    baseURL: 'http://127.0.0.1:4301',
    // Captures traces on failure even on local runs without retries
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    // --- Desktop Browsers ---
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },

    // --- Mobile Emulation ---
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
  ],

  webServer: {
    command: 'npm start -- --port 4301',
    url: 'http://127.0.0.1:4301',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});