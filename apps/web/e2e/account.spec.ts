import { expect, test } from '@playwright/test';
import { signUp, TEST_PASSWORD } from './helpers';

const NEW_PASSWORD = 'A Changed Password 99';

test.describe('Account', () => {
  test('change the password: this device stays signed in, another is signed out', async ({
    page,
    browser,
    baseURL,
  }) => {
    const email = await signUp(page, 'account');

    const other = await browser.newContext({ baseURL });
    const otherPage = await other.newPage();
    await otherPage.goto('/login');
    await otherPage.getByLabel('Email address').fill(email);
    await otherPage.getByLabel('Password').fill(TEST_PASSWORD);
    await otherPage.getByRole('button', { name: 'Sign in' }).click();
    await expect(otherPage).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    await page.getByRole('link', { name: 'Account', exact: true }).click();
    await expect(page).toHaveURL(/\/account/);
    await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();

    // A wrong current password is refused on its field and changes nothing.
    await page.getByLabel('Current password').fill('definitely not it');
    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('That is not your current password.')).toBeVisible();

    await page.getByLabel('Current password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(
      page.getByText('Password changed. Your other devices were signed out.'),
    ).toBeVisible();

    // Still signed in here.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();

    // The other device lost its session.
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/login/, { timeout: 15_000 });
    await other.close();

    // The old password no longer signs in; the new one does.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('That email and password do not match.')).toBeVisible();
    await page.getByLabel('Password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // Signed in: the header offers Sign out. (Where sign-in lands depends on the page that was
    // left, so the test does not depend on the URL.)
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 15_000 });
  });
});
