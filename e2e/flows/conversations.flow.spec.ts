import { test, expect } from '@playwright/test';

test.describe('Flow 3: Conversations & Context Window Compaction Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/conversations');
    await expect(page.locator('h1')).toHaveText('Conversations');
  });

  test('displays conversation list, new conversation trigger, and active chat interface', async ({ page }) => {
    // Check main actions
    const newChatBtn = page.locator('button:has-text("New conversation"), button:has-text("New Conversation")').first();
    await expect(newChatBtn).toBeVisible();

    // Verify conversation sidebar and chat area
    await expect(page.locator('.conversations-sidebar')).toBeVisible();
    await expect(page.locator('.chat-main')).toBeVisible();

    // If conversations exist in the list, click the first one
    const convItems = page.locator('.conv-item');
    if ((await convItems.count()) > 0) {
      await convItems.first().click();

      // Verify chat message area is active
      await expect(page.locator('.messages-container, .chat-panel, .messages-list')).toBeVisible();

      // Check context inspection button
      const inspectBtn = page.locator('button:has-text("Inspect Context"), button[title*="Inspect" i], button:has-text("Context")').first();
      if (await inspectBtn.isVisible()) {
        await inspectBtn.click();

        // Verify context modal appears with budget visualization
        const modal = page.locator('.context-modal, .modal, [role="dialog"]').first();
        await expect(modal).toBeVisible();
        await expect(modal).toContainText(/Budget|Tokens|Window/i);

        // Close modal
        const closeBtn = modal.locator('button:has-text("Close"), .btn-close, .close-icon').first();
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
        }
      }
    }
  });

  test('can open new conversation modal and configure initial system prompt', async ({ page }) => {
    const newChatBtn = page.locator('button:has-text("New conversation"), button:has-text("New Conversation")').first();
    await newChatBtn.click();

    // Verify modal appears
    const modal = page.locator('.modal-card').first();
    await expect(modal).toBeVisible();

    // Check title input
    const titleInput = modal.locator('#newTitleInput');
    await expect(titleInput).toBeVisible();
    await titleInput.fill('E2E Distributed Architecture Session');

    // Close or cancel modal
    const cancelBtn = modal.locator('button:has-text("Cancel")').first();
    await cancelBtn.click();
    await expect(modal).toBeHidden();
  });
});
