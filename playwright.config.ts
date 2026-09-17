import { defineConfig, devices } from '@playwright/test';

/**
 * E2E configuration for the LoreStitch studio shell.
 * Boots the Angular dev server and runs tests across desktop and mobile viewports.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,

  // Prevents CI runners from running out of memory while Angular dev server is running
  workers: process.env['CI'] ? 1 : undefined,

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