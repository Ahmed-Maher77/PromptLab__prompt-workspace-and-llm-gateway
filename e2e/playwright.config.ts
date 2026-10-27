import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Anchor every output path to this file so results land in e2e/artifacts no matter
// which directory Playwright is started from.
const ARTIFACTS_DIR = path.join(__dirname, 'artifacts');

/**
 * Playwright E2E & UI Flow Test Configuration for PromptLab.
 * Tests full end-to-end user journeys against the web UI (port 4200) and backend API (port 3100).
 */
export default defineConfig({
  testDir: path.join(__dirname, 'flows'),
  outputDir: path.join(ARTIFACTS_DIR, 'test-output'),
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
    ['json', { outputFile: path.join(ARTIFACTS_DIR, 'test-results.json') }],
    ['html', { outputFolder: path.join(ARTIFACTS_DIR, 'html-report'), open: 'never' }],
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
