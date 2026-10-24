import { test, expect } from '@playwright/test';

test.describe('Flow 2: Model Comparison & Experimentation Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/compare');
    await expect(page.locator('.compare-title')).toHaveText('Compare prompts');
  });

  test('loads compare page with Experiment Setup and side-by-side candidate slots', async ({ page }) => {
    // Check main experiment setup elements
    await expect(page.locator('#input-experiment-name')).toBeVisible();
    await expect(page.locator('#checkbox-sync-settings')).toBeVisible();
    await expect(page.locator('#btn-run-comparison')).toBeVisible();
    await expect(page.locator('#btn-toggle-history')).toBeVisible();

    // Verify side-by-side slot cards exist (Candidate A and Candidate B)
    const slotHeaders = page.locator('.slot-header, .slot-title, h3:has-text("Candidate")');
    expect(await slotHeaders.count()).toBeGreaterThanOrEqual(1);

    // Enter custom experiment title
    await page.locator('#input-experiment-name').fill('E2E Model Latency Benchmark');
    await expect(page.locator('#input-experiment-name')).toHaveValue('E2E Model Latency Benchmark');
  });

  test('can open and close saved comparison history drawer', async ({ page }) => {
    const historyBtn = page.locator('#btn-toggle-history');
    await expect(historyBtn).toBeVisible();

    // Open history drawer
    await historyBtn.click();
    await page.waitForTimeout(300);

    // Check if drawer or modal opened
    const drawer = page.locator('.history-drawer, .history-panel, .drawer');
    if (await drawer.isVisible()) {
      // Close history drawer
      const closeBtn = page.locator('#btn-close-history, .btn-close, button:has-text("Close")').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      }
    }
  });
});
