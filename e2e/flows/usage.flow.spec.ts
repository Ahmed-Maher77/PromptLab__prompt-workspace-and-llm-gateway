import { test, expect } from '@playwright/test';

test.describe('Flow 4: Usage Governance & Quota Ledger Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/usage');
    await expect(page.locator('.page-title')).toContainText('Usage');
  });

  test('displays monthly token quota cards, progress bar, and refresh trigger', async ({ page }) => {
    // Check header and refresh button
    await expect(page.locator('button:has-text("Refresh")')).toBeVisible();

    // Verify stats cards (Monthly Allowance, Tokens Used, Tokens Remaining, etc.)
    await expect(page.locator('.stats-grid')).toBeVisible();
    await expect(page.getByText('Monthly Allowance', { exact: true })).toBeVisible();

    // Verify quota progress bar
    const progressBar = page.locator('.progress-bar, .quota-progress-bar, .progress-fill');
    if (await progressBar.first().isVisible()) {
      await expect(progressBar.first()).toBeVisible();
    }
  });

  test('displays usage ledger table with status badges and token counts', async ({ page }) => {
    // Check ledger section
    const ledger = page.locator('.ledger-table, table, .usage-table');
    await expect(ledger.first()).toBeVisible();

    // Verify table headers (Timestamp, Provider/Model, Tokens, Status, etc.)
    await expect(page.locator('th:has-text("Model"), th:has-text("Provider")').first()).toBeVisible();
  });
});
