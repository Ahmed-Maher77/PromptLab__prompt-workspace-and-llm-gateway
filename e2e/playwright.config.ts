import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E & UI Flow Test Configuration for PromptLab.
 * Tests full end-to-end user journeys against the web UI (port 4200) and backend API (port 3100).
 */
export default defineConfig({
  testDir: './flows',
  timeout: 30_000,
  expect: {
    timeout: 7_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'e2e/artifacts/test-results.json' }],
    ['html', { outputFolder: 'e2e/artifacts/html-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env['WEB_BASE_URL'] || 'http://localhost:4200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
