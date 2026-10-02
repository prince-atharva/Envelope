import { expect, type Locator, type Page, test } from '@playwright/test';
import { expectAccessible } from './a11y';
import { createEmbedHost } from './embed-host';
import {
  agreeToSign,
  emailFor,
  openAsSigner,
  prepareToSend,
  sendFromReview,
  signingLinkFor,
  signUp,
  TEST_PASSWORD,
  uniqueEmail,
} from './helpers';

/** Presses Tab until the target has focus, so a spec proves the control is reachable from the keyboard. */
async function tabTo(page: Page, target: Locator, limit = 80): Promise<void> {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${target}`);
}

/** A signing link for a fresh one-signer envelope. */
async function sendToSigner(page: Page, prefix: string): Promise<string> {
  await signUp(page, prefix);
  const signer = { name: 'Priya Sharma', email: uniqueEmail('priya') };
  await prepareToSend(page, [signer]);
  await sendFromReview(page);
  return signingLinkFor(signer.email);
}

const signatureBox = (page: Page) =>
  page.getByRole('button', { name: /^Signature field, required, page 1 of \d+/ });
const tickBox = (page: Page) =>
  page.getByRole('checkbox', { name: /^Tick box field, required, page 1 of \d+/ });

/**
 * The signer portal and the public pages (docs/22 step 12, ADR 0035): axe, keyboard-only signing,
 * touch-target size, reduced motion and 320 px reflow.
 */
test.describe('Accessibility: signing portal and public pages', () => {
  test('axe finds nothing serious across the signing flow', async ({ page }) => {
    const link = await sendToSigner(page, 'a11y-sign');
    await openAsSigner(page, link);
    await expect(
      page.getByRole('heading', { name: 'Agreement to sign electronically' }),
    ).toBeVisible();
    await expectAccessible(page, 'signing: consent');

    await agreeToSign(page);
    await expectAccessible(page, 'signing: document');

    await signatureBox(page).click();
    const sheet = page.getByRole('dialog', { name: 'Adopt your signature' });
    await expect(sheet).toBeVisible();
    await expectAccessible(page, 'signing: adopt signature', { include: 'dialog[open]' });
    await sheet.getByRole('button', { name: 'Adopt and sign' }).click();
    await tickBox(page).check();
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByRole('heading', { name: 'Signed' })).toBeVisible();
    await expectAccessible(page, 'signing: signed');
  });

  test('public pages: verify, accept-invite, download', async ({ page, browser, baseURL }) => {
    await page.goto('/verify');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expectAccessible(page, 'verify');

    // A download link that does not exist still draws a page.
    await page.goto(`/download/${'0'.repeat(64)}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expectAccessible(page, 'download (unknown link)');

    await signUp(page, 'a11y-invite');
    await page.goto('/settings/users');
    const memberEmail = uniqueEmail('a11y-member');
    await page.getByRole('button', { name: 'Invite someone' }).click();
    await page.getByLabel('Full name').fill('Mina Member');
    await page.getByLabel('Email address').fill(memberEmail);
    await page.getByRole('button', { name: 'Send invitation' }).click();
    const invite = await emailFor(memberEmail, 'user-invited');
    const invitePath = /\/accept-invite\/[0-9a-f]{64}/.exec(invite.text)?.[0];
    if (!invitePath) throw new Error('No invitation link');

    const guest = await browser.newContext({ baseURL });
    const guestPage = await guest.newPage();
    await guestPage.goto(invitePath);
    await expect(guestPage.getByLabel('Password')).toBeVisible();
    await expectAccessible(guestPage, 'accept-invite');
    await guestPage.getByLabel('Password').fill(TEST_PASSWORD);
    await guest.close();
  });

  test('a whole signing works from the keyboard alone, with visible focus and a live progress line', async ({
    page,
  }) => {
    const link = await sendToSigner(page, 'a11y-keys');
    await openAsSigner(page, link);

    await tabTo(page, page.getByLabel('I agree to sign electronically'));
    await page.keyboard.press('Space');
    await tabTo(page, page.getByRole('button', { name: 'Review document' }));
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-pdf-overlay="1"]')).toBeAttached({ timeout: 20_000 });

    await tabTo(page, signatureBox(page));
    // The focus ring is drawn, not just logically there.
    const outline = await signatureBox(page).evaluate((el) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(outline.style).not.toBe('none');
    expect(outline.width).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Enter');

    const sheet = page.getByRole('dialog', { name: 'Adopt your signature' });
    await expect(sheet).toBeVisible();
    // The typed signature is the default: no pointer is needed to make one.
    await tabTo(page, sheet.getByRole('button', { name: 'Adopt and sign' }));
    await page.keyboard.press('Enter');
    await expect(sheet).toBeHidden();
    // Focus comes back into the document, to the box that was filled.
    await expect(signatureBox(page)).toBeFocused();

    await tabTo(page, tickBox(page));
    await page.keyboard.press('Space');
    await expect(
      page.locator('[aria-live="polite"]').filter({ hasText: /boxes? (is|are) done/ }),
    ).toBeVisible();

    await tabTo(page, page.getByRole('button', { name: 'Finish' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Signed' })).toBeVisible();
  });

  test('signing controls are at least 44 by 44 pixels', async ({ page }) => {
    const link = await sendToSigner(page, 'a11y-size');
    await openAsSigner(page, link);
    const agree = page.getByRole('button', { name: 'Review document' });
    await expect(agree).toBeVisible();
    await page.getByLabel('I agree to sign electronically').check();
    for (const control of [agree]) {
      const box = await control.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
    await agree.click();
    await expect(page.locator('[data-pdf-overlay="1"]')).toBeAttached({ timeout: 20_000 });

    // The action button reads Start until every required box is done, then Finish.
    const start = await page.getByRole('button', { name: 'Start' }).boundingBox();
    expect(start?.height ?? 0).toBeGreaterThanOrEqual(44);
    // A field on the page can be small, so its tap area is a 44 px pseudo-element around it.
    for (const field of [signatureBox(page), tickBox(page).locator('xpath=..')]) {
      const area = await field.evaluate((el) => {
        const style = getComputedStyle(el, '::before');
        return { width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) };
      });
      expect(area.width).toBeGreaterThanOrEqual(44);
      expect(area.height).toBeGreaterThanOrEqual(44);
    }

    await signatureBox(page).click();
    await page
      .getByRole('dialog', { name: 'Adopt your signature' })
      .getByRole('button', { name: 'Adopt and sign' })
      .click();
    await tickBox(page).check();
    const finish = await page.getByRole('button', { name: 'Finish' }).boundingBox();
    expect(finish?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('reduced motion stops decorative animation', async ({ page }) => {
    const link = await sendToSigner(page, 'a11y-motion');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAsSigner(page, link);
    await agreeToSign(page);
    await signatureBox(page).click();
    const sheet = page.getByRole('dialog', { name: 'Adopt your signature' });
    await expect(sheet).toBeVisible();
    const animation = await sheet.evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe('none');
    const slowest = await page.evaluate(() =>
      Math.max(
        ...Array.from(document.querySelectorAll('*')).map((el) => {
          const style = getComputedStyle(el);
          return Math.max(
            Number.parseFloat(style.animationDuration) || 0,
            Number.parseFloat(style.transitionDuration) || 0,
          );
        }),
      ),
    );
    expect(slowest).toBeLessThan(0.05);
  });

  test('the signing screens reflow at 320 px with no sideways scrolling', async ({ page }) => {
    const link = await sendToSigner(page, 'a11y-reflow');
    await page.setViewportSize({ width: 320, height: 640 });
    await openAsSigner(page, link);
    await expect(
      page.getByRole('heading', { name: 'Agreement to sign electronically' }),
    ).toBeVisible();
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);

    await agreeToSign(page);
    expect(await overflow()).toBeLessThanOrEqual(0);

    await signatureBox(page).click();
    await page
      .getByRole('dialog', { name: 'Adopt your signature' })
      .getByRole('button', { name: 'Adopt and sign' })
      .click();
    await tickBox(page).check();
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByRole('heading', { name: 'Signed' })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test('the embedded editor passes axe', async ({ page, request }) => {
    const host = await createEmbedHost(request, 'existing');
    try {
      await page.context().clearCookies();
      await page.goto(host.origin);
      await page.getByRole('button', { name: 'Prepare for signing' }).click();
      const frame = page.frameLocator('iframe');
      await expect(frame.getByRole('heading', { name: 'Prepare for signing' })).toBeVisible();
      await expectAccessible(page, 'embedded editor');
    } finally {
      await host.close();
    }
  });
});
