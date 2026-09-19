import { expect, test } from '@playwright/test';
import {
  emailFor,
  openAsSigner,
  prepareToSend,
  sendFromReview,
  signingLinkFor,
  signUp,
  TWELVE_PAGE_PDF,
  uniqueEmail,
  uploadDocument,
} from './helpers';

test.describe('Cancel and discard', () => {
  test('cancel a sent document with a reason; its link stops working', async ({ page }) => {
    await signUp(page, 'canceller');
    const priya = { name: 'Priya Sharma', email: uniqueEmail('priya') };
    await prepareToSend(page, [priya]);
    await sendFromReview(page);
    const link = await signingLinkFor(priya.email);
    // Wait until the invitation is recorded, so the dialog knows she was emailed.
    const progress = page.getByRole('region', { name: 'Signing progress' });
    await expect(progress.getByText('Email sent')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Cancel document' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/We will email Priya Sharma/)).toBeVisible();

    // A reason is required, and said so without a trip to the server.
    await dialog.getByRole('button', { name: 'Cancel document' }).click();
    await expect(
      dialog.getByText('Tell the people you sent it to why it is cancelled.'),
    ).toBeVisible();

    const reason = 'The terms changed; a new version is on its way.';
    await dialog.getByLabel('Reason').fill(reason);
    await dialog.getByRole('button', { name: 'Cancel document' }).click();

    const banner = page.getByRole('region', { name: 'Cancelled' });
    await expect(banner).toBeVisible();
    await expect(banner.getByText(reason)).toBeVisible();
    await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel document' })).toHaveCount(0);

    const notice = await emailFor(priya.email, 'voided');
    expect(notice.text).toContain(reason);
    expect(notice.text).not.toMatch(/\/sign\//);

    await openAsSigner(page, link);
    await expect(
      page.getByRole('heading', { name: 'This document has been cancelled by the sender' }),
    ).toBeVisible();
  });

  test('discard a draft without a reason', async ({ page }) => {
    await signUp(page, 'discarder');
    const envelopeId = await uploadDocument(page, TWELVE_PAGE_PDF);

    await page.getByRole('button', { name: 'Discard draft' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/nobody is emailed/)).toBeVisible();
    await expect(dialog.getByLabel('Reason')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Discard draft' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto(`/dashboard/envelopes/${envelopeId}`);
    await expect(page.getByRole('region', { name: 'Draft discarded' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Prepare for signing' })).toHaveCount(0);
  });
});
