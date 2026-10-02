import { expect, test } from '@playwright/test';
import {
  openAsSigner,
  prepareToSend,
  sendFromReview,
  signingLinkFor,
  signUp,
  uniqueEmail,
} from './helpers';

// A 1x1 PNG: enough for the server to decode and re-encode.
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('Branding (docs/22 step 8)', () => {
  test('a workspace sets a colour and logo and its signer sees them', async ({ page }) => {
    await signUp(page, 'brand-admin');
    await page.goto('/settings/branding');
    await expect(page.getByRole('heading', { name: 'Branding' })).toBeVisible();

    // A colour white text cannot be read on is stopped before it is sent.
    const colour = page.getByLabel('Colour', { exact: true });
    await colour.fill('#ffeb3b');
    await expect(page.getByText('This colour is too light for white text.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save colour' })).toBeDisabled();

    await colour.fill('#1d4ed8');
    await page.getByRole('button', { name: 'Save colour' }).click();
    await expect(page.getByText('Accent colour saved.')).toBeVisible();

    await page.getByLabel('Upload logo').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: LOGO_PNG,
    });
    await expect(page.getByText('Logo saved.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove logo' })).toBeVisible();

    // The signer's page wears it.
    const priya = { name: 'Priya Sharma', email: uniqueEmail('priya') };
    await prepareToSend(page, [priya]);
    await sendFromReview(page);
    const link = await signingLinkFor(priya.email);
    await openAsSigner(page, link);
    await expect(page.locator('img[src^="/api/v1/branding/logo/"]').first()).toBeVisible();
    await expect(page.locator('div.contents[style*="--color-brand-700: #1d4ed8"]')).toHaveCount(1);
  });

  test('removing the logo and the colour returns the product look', async ({ page }) => {
    await signUp(page, 'brand-reset');
    await page.goto('/settings/branding');
    await page.getByLabel('Colour', { exact: true }).fill('#1d4ed8');
    await page.getByRole('button', { name: 'Save colour' }).click();
    await expect(page.getByText('Accent colour saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Use the default' }).click();
    await expect(page.getByText('Back to the default colour.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use the default' })).toHaveCount(0);
  });
});
