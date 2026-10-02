import { expect, test } from '@playwright/test';
import {
  agreeToSign,
  openAsSigner,
  prepareToSend,
  sendFromReview,
  signingLinkFor,
  signUp,
  uniqueEmail,
} from './helpers';

test('the sender hands their device to a signer: signed out, signed in person, dashboard unreachable', async ({
  page,
  browser,
}) => {
  await signUp(page, 'in-person');
  const patient = uniqueEmail('pat');
  const envelopeId = await prepareToSend(page, [{ name: 'Pat Patient', email: patient }]);
  await sendFromReview(page);
  const emailedLink = await signingLinkFor(patient);

  await page.goto(`/dashboard/envelopes/${envelopeId}`);
  // Handing over must go straight to the signing page, never through the sign-in page.
  const visited: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
  });
  await page.getByRole('button', { name: 'Sign in person with Pat Patient' }).click();
  const dialog = page.getByRole('dialog', { name: 'Hand this device to Pat Patient?' });
  await expect(dialog).toContainText('You will be signed out of this browser');
  await dialog.getByRole('button', { name: 'Sign out and hand over' }).click();

  // The same browser now shows the signing page, naming the host.
  await expect(page).toHaveURL(/\/sign\/[0-9a-f]{64}$/, { timeout: 20_000 });
  expect(visited.filter((path) => path.startsWith('/login'))).toEqual([]);
  await expect(page.getByText('Signing in person, on Builder Tester’s device')).toBeVisible();
  await agreeToSign(page);
  await expect(page.getByText('Signing in person, on Builder Tester’s device')).toBeVisible();
  await page.getByRole('button', { name: /^Signature field, required, page 1 of \d+/ }).click();
  await page
    .getByRole('dialog', { name: 'Adopt your signature' })
    .getByRole('button', { name: 'Adopt and sign' })
    .click();
  await page.getByRole('checkbox', { name: /^Tick box field, required, page 1 of \d+/ }).check();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('heading', { name: 'Signed' })).toBeVisible();
  await expect(page.getByText('Please hand the device back to Builder Tester.')).toBeVisible();

  // The signer cannot reach the sender's documents from this device.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  // The emailed link was replaced when the hand-over began.
  const other = await browser.newPage();
  await openAsSigner(other, emailedLink);
  await expect(other.getByRole('heading', { name: 'This link does not work' })).toBeVisible();
  await other.close();
});

test('there is nobody to host until the document is sent', async ({ page }) => {
  await signUp(page, 'in-person-draft');
  const patient = uniqueEmail('pat');
  const envelopeId = await prepareToSend(page, [{ name: 'Pat Patient', email: patient }]);
  // Before sending, there is nobody to host.
  await page.goto(`/dashboard/envelopes/${envelopeId}`);
  await expect(page.getByRole('button', { name: /^Sign in person with/ })).toHaveCount(0);
});
