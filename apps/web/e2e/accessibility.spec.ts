import { expect, test } from '@playwright/test';
import { expectAccessible } from './a11y';
import {
  openNavigation,
  prepareToSend,
  sendFromReview,
  signingLinkFor,
  signUp,
  uniqueEmail,
} from './helpers';

/**
 * Axe over every sender-app screen and popup the gallery reaches, on the desktop and both phone
 * projects (docs/22 step 11, ADR 0035). Serious and critical findings fail the run.
 */
test.describe('Accessibility: sender app', () => {
  test('signed-out screens', async ({ page }) => {
    for (const [path, heading] of [
      ['/login', 'Sign in'],
      ['/register', 'Create your account'],
      ['/forgot-password', 'Forgot your password?'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      await expectAccessible(page, path);
    }

    // The error states are screens too: errors must be tied to their fields.
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expectAccessible(page, '/login with errors');
  });

  test('signed-in screens and popups', async ({ page }) => {
    await signUp(page, 'a11y-owner');
    await expectAccessible(page, '/dashboard (empty)');

    for (const [path, name] of [
      ['/dashboard/new', 'upload'],
      ['/templates', 'templates'],
      ['/bulk-batches', 'bulk batches'],
      ['/account', 'account'],
      ['/settings/integrations', 'integrations'],
      ['/settings/users', 'users'],
      ['/settings/branding', 'branding'],
      ['/reports', 'reports'],
      ['/verify', 'verify'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expectAccessible(page, name);
    }

    const priya = { name: 'Priya Sharma', email: uniqueEmail('priya') };
    const envelopeId = await prepareToSend(page, [priya]);
    await expectAccessible(page, 'review');

    await page.goto(`/dashboard/envelopes/${envelopeId}/prepare`);
    await expect(page.locator('[data-pdf-overlay="1"]')).toBeAttached({ timeout: 20_000 });
    await expectAccessible(page, 'prepare');

    await page.goto(`/dashboard/envelopes/${envelopeId}/review`);
    await page.getByRole('button', { name: 'Send for signing' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expectAccessible(page, 'send dialog', { include: 'dialog[open]' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    // Focus goes back to what opened the dialog.
    await expect(page.getByRole('button', { name: 'Send for signing' })).toBeFocused();

    await sendFromReview(page);
    await signingLinkFor(priya.email);
    await page.goto(`/dashboard/envelopes/${envelopeId}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expectAccessible(page, 'envelope detail (sent)');

    await page.goto('/dashboard');
    await openNavigation(page);
    await expectAccessible(page, 'dashboard (with an envelope)');
  });
});
