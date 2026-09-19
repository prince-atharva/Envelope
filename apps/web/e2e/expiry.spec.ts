import { expect, test } from '@playwright/test';
import {
  agreeToSign,
  passDeadline,
  prepareToSend,
  sendFromReview,
  signingLinkFor,
  signUp,
  uniqueEmail,
} from './helpers';

test.describe('Deadlines', () => {
  test('an expired document: the signer asks for more time, the sender gives it, the signer signs', async ({
    page,
    browser,
  }) => {
    await signUp(page, 'deadline');
    const priya = { name: 'Priya Sharma', email: uniqueEmail('priya') };
    const envelopeId = await prepareToSend(page, [priya]);
    await sendFromReview(page);
    const firstLink = await signingLinkFor(priya.email);

    await passDeadline(envelopeId);
    const banner = page.getByRole('region', { name: /Expired/ });
    await expect(async () => {
      await page.reload();
      await expect(banner).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await expect(banner.getByText(/while Priya Sharma still had to sign/)).toBeVisible();

    // The signer, in their own browser, finds the link expired and asks for more time.
    const signerContext = await browser.newContext();
    const signer = await signerContext.newPage();
    await signer.goto(firstLink);
    await expect(
      signer.getByRole('heading', { name: 'This signing link has expired' }),
    ).toBeVisible();
    await signer.getByRole('button', { name: 'Ask for more time' }).click();
    await expect(signer.getByRole('status')).toContainText(
      'We have asked the sender for more time',
    );

    await page.reload();
    await expect(banner.getByText(/Priya Sharma asked for more time/)).toBeVisible();

    await banner.getByRole('button', { name: 'Give more time' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/We will email Priya Sharma a new link/)).toBeVisible();
    await dialog.getByLabel('New deadline').selectOption('14');
    await dialog.getByRole('button', { name: 'Give more time' }).click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible();

    // The new email's link works; the one in the first email does not.
    let freshLink = firstLink;
    await expect(async () => {
      freshLink = await signingLinkFor(priya.email, 1000);
      expect(freshLink).not.toBe(firstLink);
    }).toPass({ timeout: 20_000 });
    await signer.goto(freshLink);
    await agreeToSign(signer);
    await signerContext.close();
  });
});
