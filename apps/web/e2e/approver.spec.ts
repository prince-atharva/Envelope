import { expect, test } from '@playwright/test';
import {
  addRecipient,
  agreeToSign,
  completedCopyFor,
  openAsSigner,
  openPreparePanel,
  placeField,
  selectRecipient,
  sendFromReview,
  signingLinkFor,
  signOnlyBoxes,
  signUp,
  TWELVE_PAGE_PDF,
  uniqueEmail,
  uploadDocument,
  waitForFieldsSaved,
} from './helpers';

test('an approver needs no fields: they read the document after the signer and approve it', async ({
  page,
  browser,
}) => {
  await signUp(page, 'approvals');
  const signer = uniqueEmail('sam');
  const approver = uniqueEmail('ava');

  const envelopeId = await uploadDocument(page, TWELVE_PAGE_PDF);
  await page.getByRole('link', { name: 'Prepare for signing' }).click();
  await addRecipient(page, 'Sam Signer', signer);
  await addRecipient(page, 'Ava Approver', approver);
  await page.getByLabel('Role for Ava Approver').selectOption('APPROVER');
  await expect(page.getByText('No fields needed')).toBeVisible();
  await page.getByRole('radio', { name: 'One after another' }).click();
  await expect(page.getByRole('radio', { name: 'One after another' })).toBeChecked();

  // Only the signer gets fields.
  await openPreparePanel(page, 'fields');
  await page.getByLabel('Zoom Level').selectOption('1');
  await expect(page.locator('[data-pdf-overlay="1"]')).toBeAttached({ timeout: 20_000 });
  await selectRecipient(page, 'Sam Signer');
  await placeField(page, 'Signature', 1, { xRatio: 0.2, yRatio: 0.3 });
  await waitForFieldsSaved(page, 1);
  await placeField(page, 'Tick box', 1, { xRatio: 0.2, yRatio: 0.45 });
  await waitForFieldsSaved(page, 2);

  await page.getByRole('link', { name: 'Review' }).click();
  await expect(page).toHaveURL(new RegExp(`/envelopes/${envelopeId}/review$`));
  await expect(page.getByText('No fields. They read the document and approve it.')).toBeVisible();
  await expect(page.getByText('Emailed once the person before them has signed')).toBeVisible();
  await sendFromReview(page);

  const signerPage = await browser.newPage();
  await signOnlyBoxes(signerPage, await signingLinkFor(signer));
  await signerPage.close();

  // The approver's link arrives only now, and the screen asks them to approve.
  const approverPage = await browser.newPage();
  await openAsSigner(approverPage, await signingLinkFor(approver));
  await expect(approverPage.getByText(/sent you a document to approve\./)).toBeVisible();
  await agreeToSign(approverPage);
  await expect(approverPage.getByText('Read the document, then approve it.')).toBeVisible();
  await approverPage.getByRole('button', { name: 'Approve' }).click();
  await expect(approverPage.getByRole('heading', { name: 'Approved' })).toBeVisible();
  await approverPage.close();

  await completedCopyFor(approver);
  await page.goto(`/dashboard/envelopes/${envelopeId}`);
  await expect(page.getByRole('heading', { name: 'Completed and sealed' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.locator('[data-recipient-id]').filter({ hasText: 'Ava Approver' }).getByText('Approved'),
  ).toBeVisible();
});
