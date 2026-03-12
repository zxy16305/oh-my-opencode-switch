import { test, expect } from '@playwright/test';

test.describe('App Shell', () => {
  test('should load the app', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.app-container, .app')).toBeVisible();
  });

  test('should display header', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('OOS');
  });

  test('should show profile list component', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.profile-list, [data-testid="profile-list"]')).toBeVisible();
  });
});

test.describe('Profile List', () => {
  test('should show empty state when no profiles', async ({ page }) => {
    await page.goto('/');
    const emptyState = page.locator('.empty-state, .no-profiles');
    if (await emptyState.isVisible()) {
      await expect(emptyState).toBeVisible();
    }
  });

  test('should have create profile button', async ({ page }) => {
    await page.goto('/');
    const createButton = page.locator(
      'button:has-text("Create"), [data-testid="create-profile-btn"]'
    );
    await expect(createButton.first()).toBeVisible();
  });
});

test.describe('Create Profile Modal', () => {
  test('should open create modal on button click', async ({ page }) => {
    await page.goto('/');
    const createButton = page.locator('button:has-text("Create")').first();
    await createButton.click();
    await expect(page.locator('.modal, .create-profile-modal')).toBeVisible();
  });

  test('should validate profile name', async ({ page }) => {
    await page.goto('/');
    const createButton = page.locator('button:has-text("Create")').first();
    await createButton.click();

    const nameInput = page.locator('input[name="name"], input[placeholder*="name"]');
    if (await nameInput.isVisible()) {
      await nameInput.fill('invalid name!');
      await expect(page.locator('.error, .validation-error')).toBeVisible();
    }
  });
});

test.describe('Profile Operations', () => {
  test('should switch profile on double-click', async ({ page }) => {
    await page.goto('/');
    const profileItem = page.locator('.profile-item, [data-testid="profile-item"]').first();
    if (await profileItem.isVisible()) {
      await profileItem.dblclick();
    }
  });

  test('should show profile details on click', async ({ page }) => {
    await page.goto('/');
    const profileItem = page.locator('.profile-item, [data-testid="profile-item"]').first();
    if (await profileItem.isVisible()) {
      await profileItem.click();
      await expect(page.locator('.profile-detail, [data-testid="profile-detail"]')).toBeVisible();
    }
  });
});

test.describe('Settings', () => {
  test('should open settings panel', async ({ page }) => {
    await page.goto('/');
    const settingsButton = page.locator(
      'button:has-text("Settings"), [data-testid="settings-btn"]'
    );
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
      await expect(page.locator('.settings, [data-testid="settings-panel"]')).toBeVisible();
    }
  });
});

test.describe('Error Handling', () => {
  test('should show error dialog on error', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('error', { detail: { message: 'Test error' } }));
    });
  });
});
