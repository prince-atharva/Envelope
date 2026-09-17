import { expect, test } from '@playwright/test';

const password = 'TestPassword123!';

test.describe('Authentication flow', () => {
  test('shows login page by default', async ({ page }) => {
    await page.goto('/');
    // Should redirect to /login
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('can navigate to register page', async ({ page }) => {
    await page.goto('/login');
    const registerLink = page.getByRole('link', { name: 'Create an account' });
    await expect(registerLink).toBeVisible({ timeout: 10000 });
    await registerLink.click();
    await expect(page).toHaveURL(/\/register/);
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  });

  test('shows validation errors on empty registration', async ({ page }) => {
    await page.goto('/register');
    await page.getByRole('button', { name: 'Create account' }).click();
    // Should show validation errors (zod validates on submit)
    await expect(page.locator('text=Enter your full name')).toBeVisible({ timeout: 5000 });
  });

  test('register, get redirected to dashboard, then logout and login', async ({ page }) => {
    const uniqueEmail = `test+${Date.now()}+${Math.floor(Math.random() * 100000)}@example.com`;

    // Register
    await page.goto('/register', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible({
      timeout: 15000,
    });
    const nameInput = page.getByLabel('Full name');
    await expect(nameInput).toBeVisible({ timeout: 15000 });
    await nameInput.fill('Test User E2E');
    await page.getByLabel('Email address').fill(uniqueEmail);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();

    // Logout
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);

    // Login again
    await page.getByLabel('Email address').fill(uniqueEmail);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  });
});
