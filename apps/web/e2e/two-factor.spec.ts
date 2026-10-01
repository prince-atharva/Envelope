import { expect, type Page, test } from '@playwright/test';
import {
  emailFor,
  expectSignedIn,
  openAccount,
  signOut,
  signUp,
  TEST_PASSWORD,
  uniqueEmail,
} from './helpers';
import { totpNow } from './totp';

/** Reads the key the setup screen shows, without its spaces. */
async function shownSecret(page: Page): Promise<string> {
  const text = await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4}){7}$/).innerText();
  return text.replace(/\s/g, '');
}

/** Turns two-factor on from the Account page, and returns the key and recovery codes. */
async function enableTwoFactor(page: Page): Promise<{ secret: string; codes: string[] }> {
  await openAccount(page);
  await page.getByRole('button', { name: 'Set up two-factor authentication' }).click();
  await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible();
  const secret = await shownSecret(page);
  await page.getByLabel('Code from your app').fill(totpNow(secret));
  await page.getByRole('button', { name: 'Turn on', exact: true }).click();

  const list = page.getByRole('list', { name: 'Recovery codes' });
  await expect(list).toBeVisible();
  const codes = await list.getByRole('listitem').allInnerTexts();
  expect(codes).toHaveLength(10);
  await page.getByLabel('I have saved these codes').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Two-factor authentication is on.')).toBeVisible();
  return { secret, codes };
}

async function signInWithPassword(page: Page, email: string, password = TEST_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('Two-factor authentication', () => {
  test('set up, sign in with a code and with a recovery code, then turn it off', async ({
    page,
  }) => {
    const email = await signUp(page, 'twofactor');
    const { secret, codes } = await enableTwoFactor(page);

    await signOut(page);
    await expect(page).toHaveURL(/\/login/);

    // The password alone no longer signs in: a code is asked for. The code that
    // enabled it cannot be reused, so this is the next 30-second step's.
    await signInWithPassword(page, email);
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
    await page.getByLabel('Authentication code').fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText(/That code is not valid/)).toBeVisible();
    // Signed in: the header offers Sign out. (Where sign-in lands depends on the page that was
    // left, so the test does not depend on the URL.)
    await page.getByLabel('Authentication code').fill(totpNow(secret, 1));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expectSignedIn(page);

    // A recovery code signs in once.
    await signOut(page);
    await signInWithPassword(page, email);
    await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
    await page.getByLabel('Recovery code').fill(codes[0] ?? '');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expectSignedIn(page);
    // Using a recovery code is reported to the account's owner, with how many are left.
    const notice = (await emailFor(email, 'two-factor-notice')).text;
    expect(notice).toContain('A recovery code was used to sign in');
    expect(notice).toContain('You have 9 unused recovery codes left.');

    await signOut(page);
    await signInWithPassword(page, email);
    await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
    await page.getByLabel('Recovery code').fill(codes[0] ?? '');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText(/That code is not valid/)).toBeVisible();
    await page.getByLabel('Recovery code').fill(codes[1] ?? '');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expectSignedIn(page);

    // Turning it off needs the password and a code (a recovery code will do).
    await openAccount(page);
    await expect(page.getByText(/8 unused recovery codes left/)).toBeVisible();
    await page.getByRole('button', { name: 'Turn off two-factor' }).click();
    // (Not getByLabel: the page's "Password" section region has the same name.)
    await page.locator('input[name="confirmPassword"]').fill(TEST_PASSWORD);
    await page.getByLabel('Code or recovery code').fill(codes[2] ?? '');
    await page.getByRole('button', { name: 'Turn off two-factor' }).click();
    await expect(
      page.getByRole('button', { name: 'Set up two-factor authentication' }),
    ).toBeVisible();

    // Back to the password alone.
    await signOut(page);
    await signInWithPassword(page, email);
    await expectSignedIn(page);
  });

  test('an owner requires it: an invited member must enrol, and the owner can reset them', async ({
    page,
    browser,
    baseURL,
  }) => {
    await signUp(page, 'twofactor-owner');
    await enableTwoFactor(page);

    await page.goto('/settings/users');
    // The box follows the server's answer, so click, then wait for it to be checked.
    const rule = page.getByLabel('Require two-factor for everyone');
    await rule.click();
    await expect(rule).toBeChecked();

    const memberEmail = uniqueEmail('twofactor-member');
    await page.getByRole('button', { name: 'Invite someone' }).click();
    await page.getByLabel('Full name').fill('Mina Member');
    await page.getByLabel('Email address').fill(memberEmail);
    await page.getByRole('button', { name: 'Send invitation' }).click();
    const invite = await emailFor(memberEmail, 'user-invited');
    const invitePath = /\/accept-invite\/[0-9a-f]{64}/.exec(invite.text)?.[0];
    if (!invitePath) throw new Error('No invitation link');

    // The invitation alone is not a sign-in: enrolment comes first.
    const other = await browser.newContext({ baseURL });
    const memberPage = await other.newPage();
    await memberPage.goto(invitePath);
    await memberPage.getByLabel('Password').fill(TEST_PASSWORD);
    await memberPage.getByRole('button', { name: 'Accept and sign in' }).click();
    await expect(memberPage.getByRole('heading', { name: 'Two-factor is required' })).toBeVisible();
    await memberPage.getByRole('button', { name: 'Set up two-factor' }).click();
    const secret = await shownSecret(memberPage);
    await memberPage.getByLabel('Code from your app').fill(totpNow(secret));
    await memberPage.getByRole('button', { name: 'Turn on and continue' }).click();
    await expect(memberPage.getByRole('list', { name: 'Recovery codes' })).toBeVisible();
    await memberPage.getByLabel('I have saved these codes').check();
    await memberPage.getByRole('button', { name: 'Continue to Envelope' }).click();
    await expect(memberPage).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    // The owner sees who has it on, and resets Mina, who lost her phone.
    await page.reload();
    const row = page.getByRole('listitem').filter({ hasText: 'Mina Member' });
    await expect(row.getByText('Two-factor on')).toBeVisible();
    await row.getByRole('button', { name: 'Reset two-factor for Mina Member' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Reset two-factor' }).click();
    await expect(row.getByText('Two-factor on')).toBeHidden();

    // Mina was signed out, and must set it up again to get back in.
    await memberPage.reload();
    await expect(memberPage).toHaveURL(/\/login/, { timeout: 15_000 });
    await signInWithPassword(memberPage, memberEmail);
    await expect(memberPage.getByRole('heading', { name: 'Two-factor is required' })).toBeVisible();
    await other.close();
  });
});
