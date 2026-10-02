import { expect, test } from '@playwright/test';
import {
  agreeToSign,
  emailFor,
  openAsSigner,
  prepareToSend,
  signingLinkFor,
  signUp,
  uniqueEmail,
} from './helpers';

test('a signer passes their part to someone else, who signs it, when the sender allowed it', async ({
  page,
  browser,
}) => {
  await signUp(page, 'delegation');
  const asha = uniqueEmail('asha');
  const sam = uniqueEmail('sam');
  const envelopeId = await prepareToSend(page, [{ name: 'Asha Rao', email: asha }]);

  await page.getByRole('button', { name: 'Send for signing' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Let signers pass it to someone else').check();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(/^Sent\./)).toBeVisible({ timeout: 15_000 });

  const ashaLink = await signingLinkFor(asha);
  const ashaPage = await browser.newPage();
  await openAsSigner(ashaPage, ashaLink);
  await ashaPage.getByRole('button', { name: 'Pass to someone else' }).click();
  const sheet = ashaPage.getByRole('dialog', { name: 'Pass this to someone else?' });
  await sheet.getByLabel('Their name').fill('Sam Lee');
  await sheet.getByLabel('Their email address').fill(sam);
  await sheet.getByRole('button', { name: 'Pass it on' }).click();
  await expect(
    ashaPage.getByRole('heading', { name: 'You passed this document to someone else' }),
  ).toBeVisible();

  // Her old link now says what happened.
  await ashaPage.reload();
  await expect(
    ashaPage.getByRole('heading', { name: 'You passed this document to someone else' }),
  ).toBeVisible();
  await ashaPage.close();

  // Sam has his own link and cannot pass it on again.
  await emailFor(sam, 'delegated');
  const samPage = await browser.newPage();
  await openAsSigner(samPage, await signingLinkFor(sam));
  await expect(samPage.getByRole('button', { name: 'Pass to someone else' })).toHaveCount(0);
  await agreeToSign(samPage);
  await expect(samPage.getByRole('button', { name: 'Pass to someone else' })).toHaveCount(0);
  await samPage.getByRole('button', { name: /^Signature field, required, page 1 of \d+/ }).click();
  await samPage
    .getByRole('dialog', { name: 'Adopt your signature' })
    .getByRole('button', { name: 'Adopt and sign' })
    .click();
  await samPage.getByRole('checkbox', { name: /^Tick box field, required, page 1 of \d+/ }).check();
  await samPage.getByRole('button', { name: 'Finish' }).click();
  await expect(samPage.getByRole('heading', { name: 'Signed' })).toBeVisible();
  await samPage.close();

  await page.goto(`/dashboard/envelopes/${envelopeId}`);
  await expect(page.getByText('Passed to Sam Lee')).toBeVisible();
  await expect(page.getByText('Delegated by Asha Rao')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Completed and sealed' })).toBeVisible({
    timeout: 30_000,
  });
});

test('the option is off unless the sender ticks it', async ({ page, browser }) => {
  await signUp(page, 'delegation-off');
  const ben = uniqueEmail('ben');
  await prepareToSend(page, [{ name: 'Ben Ito', email: ben }]);
  await page.getByRole('button', { name: 'Send for signing' }).click();
  await expect(
    page.getByRole('dialog').getByLabel('Let signers pass it to someone else'),
  ).not.toBeChecked();
  await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(/^Sent\./)).toBeVisible({ timeout: 15_000 });

  const benPage = await browser.newPage();
  await openAsSigner(benPage, await signingLinkFor(ben));
  await expect(
    benPage.getByRole('heading', { name: 'Agreement to sign electronically' }),
  ).toBeVisible();
  await expect(benPage.getByRole('button', { name: 'Pass to someone else' })).toHaveCount(0);
  await benPage.close();
});
