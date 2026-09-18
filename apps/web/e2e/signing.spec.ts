import { expect, type Page, test } from '@playwright/test';
import {
  agreeToSign,
  openAsSigner,
  prepareToSend,
  sendFromReview,
  signingLinkFor,
  signUp,
  uniqueEmail,
} from './helpers';

/** Sends a one-signer envelope (a signature and a tick box on page 1) and returns the link. */
async function sendToOnePerson(page: Page, name: string): Promise<{ link: string }> {
  await signUp(page, 'sender');
  const email = uniqueEmail(name.split(' ')[0]?.toLowerCase() ?? 'signer');
  await prepareToSend(page, [{ name, email }]);
  await sendFromReview(page);
  return { link: await signingLinkFor(email) };
}

const signatureBox = (page: Page) =>
  page.getByRole('button', { name: /^Signature field, required, page 1 of 12/ });
const tickBox = (page: Page) =>
  page.getByRole('checkbox', { name: 'Tick box field, required, page 1 of 12' });

test.describe('Signing', () => {
  test('agree, type a signature, tick the box and finish; the link then says it is done', async ({
    page,
  }) => {
    const { link } = await sendToOnePerson(page, 'Priya Sharma');
    await openAsSigner(page, link);

    await expect(page.getByText('has sent you a document to sign')).toBeVisible();
    await expect(page.getByTestId('consent-notice')).toContainText('DRAFT');
    await expect(page.getByRole('button', { name: 'Review document' })).toBeDisabled();
    await agreeToSign(page);

    await expect(page.getByText('0 of 2 required boxes done')).toBeVisible();
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(signatureBox(page)).toBeFocused();

    await signatureBox(page).click();
    const sheet = page.getByRole('dialog', { name: 'Adopt your signature' });
    await expect(sheet.getByLabel('Your full name')).toHaveValue('Priya Sharma');
    await sheet.getByRole('button', { name: 'Adopt and sign' }).click();
    await expect(sheet).toBeHidden();
    await expect(signatureBox(page)).toHaveAccessibleName(/signed$/);
    await expect(signatureBox(page).locator('img')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Next: Tick box' })).toBeVisible();
    await tickBox(page).check();
    await expect(page.getByText('All 2 required boxes are done.')).toBeVisible();

    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByRole('heading', { name: 'Signed' })).toBeVisible();

    // The link is spent: coming back is not an error.
    await page.goto(link);
    await expect(
      page.getByRole('heading', { name: 'You have already signed this document' }),
    ).toBeVisible();
  });

  test('draw a signature instead of typing it', async ({ page }) => {
    const { link } = await sendToOnePerson(page, 'Raj Patel');
    await openAsSigner(page, link);
    await agreeToSign(page);

    await signatureBox(page).click();
    const sheet = page.getByRole('dialog', { name: 'Adopt your signature' });
    await sheet.getByText('Draw', { exact: true }).click();
    const adopt = sheet.getByRole('button', { name: 'Adopt and sign' });
    await expect(adopt).toBeDisabled();

    const pad = sheet.getByLabel('Drawing area for your signature');
    const box = await pad.boundingBox();
    if (!box) throw new Error('The drawing area is not visible');
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(
        box.x + box.width * (0.2 + step * 0.05),
        box.y + box.height * (0.6 - Math.sin(step / 2) * 0.25),
      );
    }
    await page.mouse.up();

    const adoptRequest = page.waitForRequest((request) => request.url().endsWith('/adopt'));
    await adopt.click();
    const body = (await adoptRequest).postDataJSON() as { method: string; image: string };
    expect(body.method).toBe('DRAWN');
    expect(body.image.startsWith('data:image/png;base64,')).toBe(true);
    await expect(sheet).toBeHidden();
    await expect(signatureBox(page)).toHaveAccessibleName(/signed$/);
  });

  test('what was filled in survives a reload', async ({ page }) => {
    const { link } = await sendToOnePerson(page, 'Asha Rao');
    await openAsSigner(page, link);
    await agreeToSign(page);

    await tickBox(page).check();
    await page.reload();

    await expect(page.getByText('We restored what you filled in earlier')).toBeVisible();
    await expect(tickBox(page)).toBeChecked();
    await expect(page.getByText('1 of 2 required boxes done')).toBeVisible();
  });

  test('decline before agreeing, with a reason', async ({ page }) => {
    const { link } = await sendToOnePerson(page, 'Meera Iyer');
    await openAsSigner(page, link);

    await page.getByRole('button', { name: 'Decline to sign' }).click();
    const dialog = page.getByRole('dialog', { name: 'Decline to sign?' });
    await dialog.getByRole('button', { name: 'Decline to sign' }).click();
    await expect(dialog.getByText('Tell the sender why you are declining.')).toBeVisible();

    await dialog.getByLabel('Reason for declining').fill('The dates in clause 4 are wrong.');
    await dialog.getByRole('button', { name: 'Decline to sign' }).click();
    await expect(page.getByRole('heading', { name: 'You declined this document' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'You declined this document' })).toBeVisible();
  });

  test('a link that is not ours gets a plain explanation', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/sign/')) asked.push(request.url());
    });

    // Not even shaped like a token: refused without asking the server.
    await page.goto('/sign/not-a-real-link');
    await expect(page.getByRole('heading', { name: 'This link does not work' })).toBeVisible();
    expect(asked).toEqual([]);

    // Shaped like one, but never issued: the server says so.
    await page.goto(`/sign/${'0'.repeat(64)}`);
    await expect(page.getByRole('heading', { name: 'This link does not work' })).toBeVisible();
    expect(asked).toHaveLength(1);
  });
});
