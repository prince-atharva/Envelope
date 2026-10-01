import { expect, test } from '@playwright/test';
import { emailFor, signOut, signUp, TEST_PASSWORD, uniqueEmail } from './helpers';

const NEW_PASSWORD = 'A Brand New Password 42';

async function resetPathFrom(email: string): Promise<string> {
  const message = await emailFor(email, 'password-reset');
  const path = /\/reset-password\/[0-9a-f]{64}/.exec(message.text)?.[0];
  if (!path) throw new Error(`No reset link in the email to ${email}`);
  return path;
}

test.describe('Password reset', () => {
  test('forgot, reset from the emailed link, sign in with the new password, old link is dead', async ({
    page,
    browser,
    baseURL,
  }) => {
    const email = await signUp(page, 'reset');

    // A second device, signed in before the reset.
    const other = await browser.newContext({ baseURL });
    const otherPage = await other.newPage();
    await otherPage.goto('/login');
    await otherPage.getByLabel('Email address').fill(email);
    await otherPage.getByLabel('Password').fill(TEST_PASSWORD);
    await otherPage.getByRole('button', { name: 'Sign in' }).click();
    await expect(otherPage).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    await signOut(page);
    await expect(page).toHaveURL(/\/login/);

    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    const resetPath = await resetPathFrom(email);
    await page.goto(resetPath);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await expect(page.getByText(`${email[0]}***`)).toBeVisible();

    await page.getByLabel('New password').fill('short');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Use at least 12 characters')).toBeVisible();

    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Password changed. Sign in with your new password.')).toBeVisible();

    // The old password no longer works; the new one does.
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('That email and password do not match.')).toBeVisible();
    await page.getByLabel('Password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    // "Your password was changed" reached the inbox.
    const notice = await emailFor(email, 'password-changed');
    expect(notice.text).toContain('/forgot-password');

    // The other device was signed out by the reset.
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/login/, { timeout: 15_000 });
    await other.close();

    // The link works once.
    await signOut(page);
    await page.goto(resetPath);
    await expect(page.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();
    await page.getByRole('link', { name: 'Send me a new link' }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
  });

  test('an unknown address gets the same answer and no email', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email address').fill(uniqueEmail('nobody'));
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText(
      'If an account exists for that address, we have emailed a link to reset the password.',
    );
  });

  test('a made-up link explains itself', async ({ page }) => {
    await page.goto(`/reset-password/${'f'.repeat(64)}`);
    await expect(page.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();
  });
});
