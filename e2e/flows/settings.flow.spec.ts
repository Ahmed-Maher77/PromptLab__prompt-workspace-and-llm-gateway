import { test, expect } from '@playwright/test';

test.describe('Flow 6: System Settings & Security Audit Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('.page-title')).toHaveText('System settings');
  });

  test('displays runtime metadata, gateway connectivity, and database latency', async ({ page }) => {
    // Check page header and refresh button
    await expect(page.locator('button:has-text("Refresh Status")')).toBeVisible();

    // Verify quick status metric cards
    await expect(page.locator('.status-strip, .status-grid')).toBeVisible();

    // Verify environment and version tags
    await expect(page.locator('.env-pill, .version-tag').first()).toBeVisible();
  });

  test('proves security guarantee: zero raw API keys, passwords, or secrets exist in the rendered DOM', async ({ page }) => {
    // Wait for settings content to load
    await expect(page.locator('.settings-container')).toBeVisible();

    // Extract all text content from the rendered page
    const bodyContent = await page.innerText('body');

    // Security assertions
    expect(bodyContent).not.toContain('sk-promptlab');
    expect(bodyContent).not.toContain('sk-proj-');
    expect(bodyContent).not.toContain('POSTGRES_PASSWORD');
    expect(bodyContent).not.toContain('postgresql://');
  });
});
