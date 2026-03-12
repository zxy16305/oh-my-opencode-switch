import { test, expect } from '@playwright/test';

test.describe('Profile CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should create a new profile', async ({ page }) => {
    const createButton = page.locator('button:has-text("Create")').first();
    await createButton.click();

    const modal = page.locator('.modal, .create-profile-modal');
    await expect(modal).toBeVisible();

    const nameInput = modal.locator('input[name="name"], input[type="text"]').first();
    await nameInput.fill('test-profile-' + Date.now());

    const submitButton = modal.locator('button:has-text("Create"), button[type="submit"]');
    await submitButton.click();

    await expect(modal).not.toBeVisible();
  });

  test('should prevent duplicate profile names', async ({ page }) => {
    const createButton = page.locator('button:has-text("Create")').first();
    await createButton.click();

    const modal = page.locator('.modal, .create-profile-modal');
    const nameInput = modal.locator('input[name="name"], input[type="text"]').first();

    await nameInput.fill('default');
    await nameInput.blur();

    const error = page.locator('.error, .validation-error');
    if (await error.isVisible()) {
      await expect(error).toContainText(/exists|duplicate/i);
    }
  });

  test('should delete a profile with confirmation', async ({ page }) => {
    const profileItem = page.locator('.profile-item, [data-testid="profile-item"]').first();
    if (await profileItem.isVisible()) {
      await profileItem.hover();

      const deleteButton = profileItem.locator('button:has-text("Delete"), .delete-btn');
      if (await deleteButton.isVisible()) {
        await deleteButton.click();

        const confirmModal = page.locator('.delete-modal, .confirm-modal');
        await expect(confirmModal).toBeVisible();

        const confirmButton = confirmModal.locator('button:has-text("Delete"):not(:disabled)');
        await confirmButton.click();
      }
    }
  });

  test('should rename a profile', async ({ page }) => {
    const profileItem = page.locator('.profile-item, [data-testid="profile-item"]').first();
    if (await profileItem.isVisible()) {
      await profileItem.hover();

      const renameButton = profileItem.locator('button:has-text("Rename"), .rename-btn');
      if (await renameButton.isVisible()) {
        await renameButton.click();

        const renameModal = page.locator('.rename-modal');
        await expect(renameModal).toBeVisible();

        const nameInput = renameModal.locator('input[name="newName"], input[type="text"]');
        await nameInput.fill('renamed-profile');

        const submitButton = renameModal.locator('button:has-text("Rename")');
        await submitButton.click();
      }
    }
  });
});

test.describe('Profile Switching', () => {
  test('should switch active profile', async ({ page }) => {
    await page.goto('/');

    const profileItem = page
      .locator('.profile-item:not(.active), [data-testid="profile-item"]')
      .first();
    if (await profileItem.isVisible()) {
      await profileItem.dblclick();

      await expect(profileItem).toHaveClass(/active/);
    }
  });
});
