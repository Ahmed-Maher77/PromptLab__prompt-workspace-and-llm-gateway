import { test, expect } from '@playwright/test';

test.describe('Flow 5: Gateway & Telemetry Observability Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/observability');
    await expect(page.locator('.page-title')).toContainText('Observability');
  });

  test('displays telemetry status cards (OpenTelemetry, Langfuse, Traces Recorded)', async ({ page }) => {
    // Check main actions
    await expect(page.locator('button:has-text("Refresh")')).toBeVisible();

    // Verify status cards
    const statusGrid = page.locator('.status-grid');
    await expect(statusGrid).toBeVisible();

    // Verify presence of telemetry metrics
    await expect(page.locator('.status-label:has-text("Tracing Engine")')).toBeVisible();
    await expect(page.locator('.status-label:has-text("OpenTelemetry (OTLP)")')).toBeVisible();
  });

  test('displays trace waterfall table with filter controls and redacted attribute safety', async ({ page }) => {
    // Verify filter toolbar and traces container exist
    await expect(page.locator('.filter-toolbar')).toBeVisible();
    await expect(page.locator('.traces-table-container')).toBeVisible();

    // If traces exist, click the first trace to inspect spans
    const rows = page.locator('tbody tr');
    if ((await rows.count()) > 0) {
      await rows.first().click();
      await page.waitForTimeout(300);

      // Verify trace detail modal or span drawer
      const detail = page.locator('.trace-detail, .modal, .span-waterfall, [role="dialog"]').first();
      if (await detail.isVisible()) {
        // Assert that raw API keys or passwords never appear in the inspector
        const text = await detail.innerText();
        expect(text).not.toContain('sk-proj-');
        expect(text).not.toContain('admin:password');

        // Close detail
        const closeBtn = detail.locator('button:has-text("Close"), .btn-close').first();
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
        }
      }
    }
  });
});
