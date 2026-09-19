import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  completedCopyFor,
  prepareToSend,
  sendFromReview,
  signingLinkFor,
  signOnlyBoxes,
  signUp,
  uniqueEmail,
} from './helpers';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * The sender's Completed screen (docs/15 step 8): sealed, the finished
 * document's fingerprint, its download, and the version chain.
 */
test('the sender sees the sealed document, its fingerprint, and downloads it', async ({
  page,
  browser,
}) => {
  await signUp(page, 'sender');
  const email = uniqueEmail('closer');
  const envelopeId = await prepareToSend(page, [{ name: 'Cleo Closer', email }]);
  await sendFromReview(page);

  // The signer, in a browser of their own.
  const signerContext = await browser.newContext({ ...test.info().project.use });
  try {
    await signOnlyBoxes(await signerContext.newPage(), await signingLinkFor(email));
  } finally {
    await signerContext.close();
  }
  const copy = await completedCopyFor(email);

  // The page checks for progress by itself; a reload is quicker.
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Completed and sealed' })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`/envelopes/${envelopeId}$`));

  await expect(page.getByTestId('final-hash')).toHaveText(copy.sha256);
  await expect(page.getByTestId('shown-version')).toContainText('the sealed document');
  await expect(page.getByText('Signed by Cleo Closer')).toBeVisible();
  await expect(page.getByText('Certificate added, sealed and locked')).toBeVisible();
  await expect(page.locator('[data-recipient-id]').getByText(/^Finished copy sent/)).toBeVisible();
  await expect(page.getByText(/^Sent\. We are emailing/)).toHaveCount(0);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download signed document' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('test-12-pages (signed).pdf');
  const path = await download.path();
  const bytes = await readFile(path);
  // The file the sender downloads is the one everyone was emailed, and on record.
  expect(sha256(bytes)).toBe(copy.sha256);
  expect(sha256(bytes)).toBe(sha256(await readFile(copy.file)));
});
