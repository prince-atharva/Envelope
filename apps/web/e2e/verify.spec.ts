import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import {
  agreeToSign,
  completedCopyFor,
  openAsSigner,
  prepareToSend,
  sendFromReview,
  signingLinkFor,
  signUp,
  TWELVE_PAGE_PDF,
  uniqueEmail,
  uploadDocument,
} from './helpers';

/** Opens Verify with no session, as anyone holding a copy would, and checks a file. */
async function verify(page: Page, file: string | { name: string; buffer: Buffer }) {
  await page.context().clearCookies();
  await page.goto('/verify');
  await expect(page.getByRole('heading', { name: 'Verify a document' })).toBeVisible();
  await page
    .locator('input[type="file"]')
    .setInputFiles(typeof file === 'string' ? file : { ...file, mimeType: 'application/pdf' });
  await expect(page.getByTestId('verify-result')).toBeVisible({ timeout: 15_000 });
}

test.describe('Verify', () => {
  test('confirms the finished document everyone was emailed', async ({ page }) => {
    await signUp(page, 'sender');
    const email = uniqueEmail('verifier');
    await prepareToSend(page, [{ name: 'Vera Fied', email }]);
    await sendFromReview(page);

    await openAsSigner(page, await signingLinkFor(email));
    await agreeToSign(page);
    await page.getByRole('button', { name: /^Signature field, required, page 1 of 12/ }).click();
    await page
      .getByRole('dialog', { name: 'Adopt your signature' })
      .getByRole('button', { name: 'Adopt and sign' })
      .click();
    await page.getByRole('checkbox', { name: 'Tick box field, required, page 1 of 12' }).check();
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByRole('heading', { name: 'Signed' })).toBeVisible();

    const copy = await completedCopyFor(email);
    await verify(page, copy.file);
    await expect(page.getByTestId('verify-result')).toHaveAttribute('data-outcome', 'verified');
    await expect(
      page.getByRole('heading', { name: 'This is the sealed, finished document' }),
    ).toBeVisible();
    // The page's fingerprint is the one the email gave.
    await expect(page.getByTestId('verify-hash')).toHaveText(copy.sha256);
    await expect(page.getByText('Vera Fied', { exact: true })).toBeVisible();
    await expect(page.locator('li[aria-current="true"]')).toContainText(
      'Sealed, with the certificate',
    );

    await page.getByRole('button', { name: 'Check another file' }).click();
    await expect(page.getByText('Drop a PDF here, or click to choose')).toBeVisible();
  });

  test('says a file it does not know may be unsigned or changed, never fake', async ({ page }) => {
    const pdf = Buffer.from(`%PDF-1.7\n% never signed ${randomUUID()}\n%%EOF\n`);
    await verify(page, { name: 'unknown.pdf', buffer: pdf });
    await expect(page.getByRole('heading', { name: 'No match found' })).toBeVisible();
    await expect(page.getByText(/or it has been changed since it was signed/)).toBeVisible();
    await expect(page.getByText('Signers')).toHaveCount(0);
  });

  test('says an uploaded but unsigned original is only that', async ({ page }) => {
    await signUp(page, 'sender');
    await uploadDocument(page, TWELVE_PAGE_PDF);
    await verify(page, TWELVE_PAGE_PDF);
    await expect(page.getByRole('heading', { name: 'This is an unsigned original' })).toBeVisible();
    await expect(page.getByText('Signers')).toHaveCount(0);
  });
});
