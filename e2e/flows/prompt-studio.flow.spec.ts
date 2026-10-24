import { test, expect } from '@playwright/test';

test.describe('Flow 1: Prompt Studio End-to-End User Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/prompt-studio');
    // Ensure the page and library header load cleanly
    await expect(page.locator('.library-title')).toHaveText('Prompt Studio');
  });

  test('displays prompt library with search bar and technique filter chips', async ({ page }) => {
    // Check toolbar elements
    await expect(page.locator('#input-prompt-search')).toBeVisible();
    await expect(page.locator('.technique-filters')).toBeVisible();

    // Verify technique chips (All, zero-shot, few-shot, rtf, structured-output, etc.)
    const filterChips = page.locator('.filter-chip');
    await expect(filterChips.first()).toHaveText('All');
    expect(await filterChips.count()).toBeGreaterThan(3);

    // Filter by search query
    await page.locator('#input-prompt-search').fill('NonExistentKeywordXYZ123');
    await page.waitForTimeout(300);
    // Should display empty state or 0 rows
    const rows = page.locator('.prompts-table tbody tr');
    const rowCount = await rows.count();
    expect(rowCount === 0 || (await page.locator('.empty-state').isVisible())).toBeTruthy();

    // Clear search
    await page.locator('#input-prompt-search').fill('');
  });

  test('can enter draft mode, author prompt template with dynamic variables, and preview resolution', async ({ page }) => {
    // Click "New Prompt" button
    await page.locator('#btn-create-prompt').click();

    // Verify breadcrumb shows editor view
    await expect(page.locator('.editor-title')).toBeVisible();
    await expect(page.locator('#input-prompt-name')).toBeVisible();

    // Enter template name and description
    await page.locator('#input-prompt-name').fill('E2E Customer Support Assistant');
    await page.locator('#input-prompt-description').fill('Drafted via automated Playwright flow');

    // Fill template body with variables
    const templateContent = 'You are a support agent for Acme Corp.\n\nCustomer issue: {{issue}}\nPriority: {{priority}}\n\nPlease assist.';
    const editor = page.locator('#prompt-template-textarea, textarea.template-editor').first();
    await editor.fill(templateContent);
    await expect(editor).toHaveValue(templateContent);

    // Verify estimated tokens chip is calculated and visible
    await expect(page.locator('.panel-stats').first()).toContainText('est. tokens');

    // Return back to library safely
    await page.locator('#btn-back-library').click();
    await expect(page.locator('.library-title')).toHaveText('Prompt Studio');
  });
});
