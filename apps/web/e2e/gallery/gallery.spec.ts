import { expect, test } from '@playwright/test';
import pg from 'pg';
import { createEmbedHost } from '../embed-host';
import {
  addRecipient,
  agreeToSign,
  allSigningTokens,
  DEMO_AGREEMENT_PDF,
  emailFor,
  openAsSigner,
  passDeadline,
  placeField,
  selectRecipient,
  sendFromReview,
  signingLinkFor,
  signOnlyBoxes,
  signUpAs,
  TEST_PASSWORD,
  uniqueEmail,
  uploadDocument,
  waitForFieldsSaved,
} from '../helpers';
import { STACK_ENV } from '../stack/stack.mjs';
import { totpNow } from '../totp';
import { GALLERY_DIR, overlayReady, pdfReady, shot, writeContactSheet } from './shot';

/** Fingerprints differ on every run, so every shot masks them. */
const HASHES = '[data-testid="final-hash"], [data-testid="original-hash"]';

/**
 * The UI gallery.
 *
 * Walks the product end to end and photographs every screen, popup, banner and
 * empty state with realistic data, so the look and feel can be reviewed in one
 * sitting rather than by clicking through the app. It asserts almost nothing —
 * `playwright.config.ts` owns behaviour; this owns appearance.
 */

const SENDER = { fullName: 'Nisha Menon', organisation: 'Riverside Health Partners' };
const PRIYA = 'Priya Sharma';
const RAJ = 'Raj Patel';

test.afterAll(() => {
  const index = writeContactSheet();
  // biome-ignore lint/suspicious/noConsole: the reviewer needs the path to open.
  if (index) console.log(`\n  UI gallery: ${index}\n`);
});

test('public and auth screens', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await shot(page, 'login', { area: 'auth', caption: 'Sign in, at rest.' });

  await page.getByRole('button', { name: 'Sign in' }).click();
  await shot(page, 'login-errors', {
    area: 'auth',
    caption: 'Sign in after submitting an empty form: field-level validation.',
  });

  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await shot(page, 'register', { area: 'auth', caption: 'Create an account, at rest.' });

  await page.getByRole('button', { name: 'Create account' }).click();
  await shot(page, 'register-errors', {
    area: 'auth',
    caption: 'Create an account with nothing filled in.',
  });

  await page.goto('/forgot-password');
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  await shot(page, 'forgot-password', { area: 'auth', caption: 'Ask for a password-reset link.' });

  await page.getByLabel('Email address').fill(uniqueEmail('nisha.menon'));
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await shot(page, 'forgot-password-sent', {
    area: 'auth',
    caption: 'After asking: the same answer for every address.',
  });

  await page.goto(`/reset-password/${'0'.repeat(64)}`);
  await expect(page.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();
  await shot(page, 'reset-password-invalid', {
    area: 'auth',
    caption: 'A reset link that is used, replaced or made up.',
  });

  // Verify is reachable without a session; this is what the public sees.
  await page.goto('/verify');
  await expect(page.getByRole('heading', { name: 'Verify a document' })).toBeVisible();
  await shot(page, 'verify-idle', {
    area: 'verify',
    caption: 'Public verification page before a file is chosen.',
  });
});

test('password reset screens', async ({ page }) => {
  const email = await signUpAs(page, 'gallery-reset', SENDER);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  const message = await emailFor(email, 'password-reset');
  const path = /\/reset-password\/[0-9a-f]{64}/.exec(message.text)?.[0];
  if (!path) throw new Error('No reset link in the email');
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await shot(page, 'reset-password', {
    area: 'auth',
    caption: 'Choose a new password from the emailed link.',
    mask: [page.getByText(/^Choose a new password for /)],
  });

  await page.getByLabel('New password').fill('short');
  await page.getByRole('button', { name: 'Change password' }).click();
  await shot(page, 'reset-password-errors', {
    area: 'auth',
    caption: 'A password that breaks the policy is stopped before it is sent.',
    mask: [page.getByText(/^Choose a new password for /)],
  });

  await page.getByLabel('New password').fill('A Gallery Reset Password 7');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed. Sign in with your new password.')).toBeVisible();
  await shot(page, 'login-password-changed', {
    area: 'auth',
    caption: 'Sign in after a reset: the notice says the password changed.',
  });
});

test('account screen', async ({ page }) => {
  await signUpAs(page, 'gallery-account', SENDER);
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await shot(page, 'account', {
    area: 'account',
    caption: 'Account: change your own password.',
    mask: [page.getByText(/^How you sign in as /)],
  });

  await page.getByLabel('Current password').fill(TEST_PASSWORD);
  await page.getByLabel('New password').fill('short');
  await page.getByRole('button', { name: 'Change password' }).click();
  await shot(page, 'account-errors', {
    area: 'account',
    caption: 'A new password that breaks the policy is stopped before it is sent.',
    mask: [page.getByText(/^How you sign in as /)],
  });
});

test('two-factor screens', async ({ page }) => {
  const email = await signUpAs(page, 'gallery-2fa', SENDER);
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await shot(page, 'account-two-factor-off', {
    area: 'account',
    caption: 'Account with two-factor off.',
    mask: [page.getByText(/^How you sign in as /)],
  });

  await page.getByRole('button', { name: 'Set up two-factor authentication' }).click();
  await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible();
  const secretText = await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4}){7}$/).innerText();
  const secret = secretText.replace(/\s/g, '');
  await shot(page, 'two-factor-setup', {
    area: 'account',
    caption: 'Setting up: scan the code, or type the key.',
    mask: [
      page.getByAltText('QR code for your authenticator app'),
      page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4}){7}$/),
      page.getByText(/^How you sign in as /),
    ],
  });
  await page.getByLabel('Code from your app').fill(totpNow(secret));
  await page.getByRole('button', { name: 'Turn on', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Recovery codes' })).toBeVisible();
  await shot(page, 'two-factor-recovery-codes', {
    area: 'account',
    caption: 'Ten single-use recovery codes, shown once.',
    mask: [
      page.getByRole('list', { name: 'Recovery codes' }),
      page.getByText(/^How you sign in as /),
    ],
  });
  await page.getByLabel('I have saved these codes').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Two-factor authentication is on.')).toBeVisible();
  await shot(page, 'account-two-factor-on', {
    area: 'account',
    caption: 'Account with two-factor on.',
    mask: [page.getByText(/^How you sign in as /)],
  });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await shot(page, 'sign-in-code', { area: 'auth', caption: 'Sign in: the code step.' });
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
  await shot(page, 'sign-in-recovery-code', {
    area: 'auth',
    caption: 'Sign in with a recovery code instead.',
  });
});

test('dashboard, upload, prepare, review and send', async ({ page }) => {
  await signUpAs(page, 'gallery', SENDER);

  await shot(page, 'dashboard-empty', {
    area: 'dashboard',
    caption: 'A brand new workspace: the three-step starter guide.',
    fullPage: true,
  });

  // --- upload ---
  await page.goto('/dashboard/new');
  await expect(page.getByRole('heading', { name: 'Upload a document' })).toBeVisible();
  await shot(page, 'upload-idle', { area: 'create', caption: 'The upload screen, waiting.' });

  const envelopeId = await uploadDocument(page, DEMO_AGREEMENT_PDF);
  await pdfReady(page);
  await shot(page, 'envelope-draft', {
    area: 'create',
    caption: 'A freshly uploaded draft: fingerprint, viewer and next step.',
    fullPage: true,
    mask: [page.locator(HASHES)],
  });

  // --- prepare ---
  await page.getByRole('link', { name: 'Prepare for signing' }).click();
  await pdfReady(page);
  await shot(page, 'prepare-empty', {
    area: 'prepare',
    caption: 'The builder before anyone is added: the palette is disabled and says why.',
  });

  await addRecipient(page, PRIYA, uniqueEmail('priya'));
  await addRecipient(page, RAJ, uniqueEmail('raj'));
  await shot(page, 'prepare-signers', {
    area: 'prepare',
    caption: 'Two recipients added, each with a colour, a role and a field count.',
  });

  await page.getByRole('tab', { name: /Signers & order/ }).click();
  await page.getByRole('radio', { name: 'One after another' }).click();
  await expect(page.getByRole('radio', { name: 'One after another' })).toBeChecked();
  await shot(page, 'prepare-order', {
    area: 'prepare',
    caption: 'Signing one after another: the order is numbered and can be reordered.',
  });

  await page.getByRole('tab', { name: /Fields & tools/ }).click();
  await page.getByLabel('Zoom Level').selectOption('1');
  await overlayReady(page);

  await selectRecipient(page, PRIYA);
  const signatureTool = page.getByRole('button', { name: 'Signature', exact: true });
  await signatureTool.click();
  await shot(page, 'prepare-armed', {
    area: 'prepare',
    caption: 'A field type is armed: the floating banner says what to do next.',
  });
  await signatureTool.click(); // disarm, so placeField's own arming click lands

  await placeField(page, 'Signature', 1, { xRatio: 0.2, yRatio: 0.3 });
  await waitForFieldsSaved(page, 1);
  await placeField(page, 'Tick box', 1, { xRatio: 0.2, yRatio: 0.45 });
  await waitForFieldsSaved(page, 2);
  await selectRecipient(page, RAJ);
  await placeField(page, 'Signature', 1, { xRatio: 0.6, yRatio: 0.3 });
  await waitForFieldsSaved(page, 3);
  await placeField(page, 'Tick box', 1, { xRatio: 0.6, yRatio: 0.45 });
  await waitForFieldsSaved(page, 4);

  await page.locator('[data-field-id]').first().click();
  await shot(page, 'prepare-selected', {
    area: 'prepare',
    caption: 'A placed field selected: resize handles and the inspector panel.',
  });

  // The role change and the removal each raise our own confirmation now, in
  // place of the browser's window.confirm.
  await page.getByRole('tab', { name: /Signers & order/ }).click();
  await page.getByLabel(`Role for ${RAJ}`).selectOption('CC');
  await shot(page, 'prepare-confirm-role', {
    area: 'prepare',
    caption: 'Changing a role to one that cannot hold fields warns before discarding them.',
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Keep as it is' }).click();

  // --- review ---
  await page.goto(`/dashboard/envelopes/${envelopeId}/review`);
  await expect(page.getByRole('button', { name: 'Send for signing' })).toBeVisible();
  await shot(page, 'review', {
    area: 'review',
    caption: 'The last screen before an irreversible action: who gets what, and when.',
    fullPage: true,
    mask: [page.locator(`${HASHES}, .select-all`)],
  });

  await page.getByRole('button', { name: 'Send for signing' }).click();
  const sendDialog = page.getByRole('dialog');
  await expect(sendDialog).toBeVisible();
  await shot(page, 'send-dialog', {
    area: 'review',
    caption: 'The send dialog: who is emailed now, who later, the deadline and reminders.',
  });

  await sendDialog
    .getByLabel(/Message in the email/)
    .fill('Please sign by Friday — any questions, just reply to this email.');
  await shot(page, 'send-dialog-message', {
    area: 'review',
    caption: 'The same dialog with an optional covering message filled in.',
  });

  await sendDialog.getByRole('button', { name: 'Send' }).click();
  await expect(page).toHaveURL(new RegExp(`/envelopes/${envelopeId}$`));
  await shot(page, 'sent-banner', {
    area: 'track',
    caption: 'Back on the document after sending, with the confirmation banner.',
    fullPage: true,
    mask: [page.locator(HASHES)],
  });
});

test('tracking, history and the sender dialogs', async ({ page, browser }) => {
  const email = await signUpAs(page, 'gallery-track', SENDER);
  const priyaEmail = uniqueEmail('priya');

  const envelopeId = await uploadDocument(page, DEMO_AGREEMENT_PDF);
  await page.getByRole('link', { name: 'Prepare for signing' }).click();
  await addRecipient(page, PRIYA, priyaEmail);
  await page.getByLabel('Zoom Level').selectOption('1');
  await overlayReady(page);
  await placeField(page, 'Signature', 1, { xRatio: 0.25, yRatio: 0.35 });
  await waitForFieldsSaved(page, 1);
  await placeField(page, 'Tick box', 1, { xRatio: 0.25, yRatio: 0.5 });
  await waitForFieldsSaved(page, 2);
  await page.getByRole('link', { name: 'Review' }).click();
  await sendFromReview(page);
  await pdfReady(page);

  await shot(page, 'progress', {
    area: 'track',
    caption: 'Signing progress: where each recipient is, and how to nudge them.',
    fullPage: true,
    mask: [page.locator(HASHES)],
  });

  await page.getByRole('tab', { name: /Audit trail/ }).click();
  await shot(page, 'audit-trail', {
    area: 'track',
    caption: 'The audit trail tab: every event, in order.',
  });

  await page.getByRole('tab', { name: /Versions/ }).click();
  await shot(page, 'versions', {
    area: 'track',
    caption: 'The versions tab: one document version per signature.',
  });

  // --- the sender's dialogs ---
  await page.getByRole('button', { name: /Give more time/ }).click();
  await shot(page, 'extend-dialog', {
    area: 'track',
    caption: 'Give more time: the new deadline, and who gets a fresh link.',
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Not now' }).click();

  await page
    .getByRole('button', { name: /Cancel document|Cancel/ })
    .first()
    .click();
  const cancelDialog = page.getByRole('dialog');
  await expect(cancelDialog).toBeVisible();
  await shot(page, 'cancel-dialog', {
    area: 'track',
    caption: 'Cancelling a sent document: who is told, and a reason they will read.',
  });

  await cancelDialog.getByRole('button', { name: 'Cancel document' }).click();
  await shot(page, 'cancel-dialog-error', {
    area: 'track',
    caption: 'The same dialog when the reason is left empty.',
  });
  await cancelDialog.getByRole('button', { name: 'Keep it' }).click();

  // --- the dashboard, now that there is something in it ---
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await expect(
    page.getByTestId('envelope-list').or(page.getByRole('heading', { level: 3 })),
  ).toBeVisible({ timeout: 20_000 });
  await shot(page, 'dashboard-list', {
    area: 'dashboard',
    caption: 'The document list with progress, status and deadline.',
    fullPage: true,
  });

  for (const view of ['attention', 'waiting', 'drafts', 'completed', 'cancelled'] as const) {
    await page.goto(`/dashboard?view=${view}`);
    await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
    await expect(
      page.getByTestId('envelope-list').or(page.getByRole('heading', { level: 3 })),
    ).toBeVisible({ timeout: 20_000 });
    await shot(page, `dashboard-${view}`, {
      area: 'dashboard',
      caption: `The "${view}" tab.`,
      fullPage: true,
    });
  }

  await page.goto('/dashboard?view=all');
  const dashboardSearch = page.getByLabel('Search documents', { exact: true });
  await expect(dashboardSearch).toBeVisible({ timeout: 30_000 });
  await dashboardSearch.fill('zzz-no-such-document');
  await shot(page, 'dashboard-no-results', {
    area: 'dashboard',
    caption: 'Searching for something that is not there.',
  });

  // --- ⌘K search ---
  await dashboardSearch.clear();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await shot(page, 'search-modal', {
    area: 'dashboard',
    caption: 'Quick search (⌘K) with recent documents.',
  });

  await page.getByRole('dialog').getByRole('combobox').fill('zzz');
  await shot(page, 'search-modal-empty', {
    area: 'dashboard',
    caption: 'Quick search with no match.',
  });
  await page.keyboard.press('Escape');

  // --- the completed document ---
  const signerContext = await browser.newContext({ ...test.info().project.use });
  try {
    await signOnlyBoxes(await signerContext.newPage(), await signingLinkFor(priyaEmail));
  } finally {
    await signerContext.close().catch(() => undefined);
  }

  await page.goto(`/dashboard/envelopes/${envelopeId}`);
  await expect(page.getByRole('heading', { name: 'Completed and sealed' })).toBeVisible({
    timeout: 60_000,
  });
  await pdfReady(page);
  await shot(page, 'completed', {
    area: 'track',
    caption: 'Completed and sealed: the final fingerprint and who signed.',
    fullPage: true,
    mask: [page.locator(HASHES)],
  });

  // --- verify the sealed copy the signer was emailed ---
  await page.goto('/verify');
  await expect(page.getByRole('heading', { name: 'Verify a document' })).toBeVisible();
  await shot(page, 'verify-signed-in', {
    area: 'verify',
    caption: 'Verify, reached from the signed-in header — note the way back.',
  });

  expect(email).toBeTruthy();
});

test('the signer portal', async ({ page, browser }) => {
  const senderContext = await browser.newContext({ ...test.info().project.use });
  const sender = await senderContext.newPage();
  await signUpAs(sender, 'gallery-signer', SENDER);
  const signerEmail = uniqueEmail('asha');

  await uploadDocument(sender, DEMO_AGREEMENT_PDF);
  await sender.getByRole('link', { name: 'Prepare for signing' }).click();
  await addRecipient(sender, 'Asha Rao', signerEmail);
  await sender.getByLabel('Zoom Level').selectOption('1');
  await overlayReady(sender);
  await placeField(sender, 'Signature', 1, { xRatio: 0.25, yRatio: 0.35 });
  await waitForFieldsSaved(sender, 1);
  await placeField(sender, 'Tick box', 1, { xRatio: 0.25, yRatio: 0.5 });
  await waitForFieldsSaved(sender, 2);
  await sender.getByRole('link', { name: 'Review' }).click();
  await sendFromReview(sender);
  await senderContext.close();

  const link = await signingLinkFor(signerEmail);
  await openAsSigner(page, link);

  await expect(page.getByTestId('consent-notice')).toBeVisible();
  await shot(page, 'consent', {
    area: 'signer',
    caption: 'The consent gate: the document is not fetched until this is agreed.',
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Decline to sign' }).click();
  await shot(page, 'decline-from-consent', {
    area: 'signer',
    caption: 'Declining before agreeing: a reason is required.',
  });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Keep|Cancel|Not now/ })
    .first()
    .click();

  await agreeToSign(page);
  await pdfReady(page);
  await shot(page, 'workspace', {
    area: 'signer',
    caption: 'The signing workspace, with the guided action dock pinned above the fold.',
  });

  await page.locator('[data-signing-field]').first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await shot(page, 'adopt-type', {
    area: 'signer',
    caption: 'Adopting a signature by typing: three handwriting faces to choose from.',
  });

  await sheet.getByText('Draw', { exact: true }).click();
  await shot(page, 'adopt-draw', {
    area: 'signer',
    caption: 'The draw tab, with the baseline guide, before anything is drawn.',
  });
  await page.keyboard.press('Escape');

  await shot(page, 'workspace-progress', {
    area: 'signer',
    caption: 'The dock counts what is left and turns into Finish when nothing is.',
  });
});

test('the signer edge cases', async ({ page, browser }) => {
  const sender = page;
  await signUpAs(sender, 'gallery-edge', SENDER);
  const signerEmail = uniqueEmail('vera');

  const envelopeId = await uploadDocument(sender, DEMO_AGREEMENT_PDF);
  await sender.getByRole('link', { name: 'Prepare for signing' }).click();
  await addRecipient(sender, 'Vera Fied', signerEmail);
  await sender.getByLabel('Zoom Level').selectOption('1');
  await overlayReady(sender);
  await placeField(sender, 'Signature', 1, { xRatio: 0.25, yRatio: 0.35 });
  await waitForFieldsSaved(sender, 1);
  await sender.getByRole('link', { name: 'Review' }).click();
  await sendFromReview(sender);

  const link = await signingLinkFor(signerEmail);

  const signerContext = await browser.newContext({ ...test.info().project.use });
  const signer = await signerContext.newPage();

  // A link that never existed.
  const tokens = await allSigningTokens();
  expect(tokens.length).toBeGreaterThan(0);
  await openAsSigner(signer, '/sign/not-a-real-token-at-all');
  await shot(signer, 'end-invalid', {
    area: 'signer-ends',
    caption: 'A link that does not work — stated plainly, not as an error.',
  });

  // Past the deadline.
  await passDeadline(envelopeId);
  await openAsSigner(signer, link);
  await expect(signer.getByRole('heading', { name: 'This signing link has expired' })).toBeVisible({
    timeout: 30_000,
  });
  await shot(signer, 'end-expired', {
    area: 'signer-ends',
    caption: 'An expired link, with "Ask for more time" rather than a dead end.',
  });

  await signer.getByRole('button', { name: 'Ask for more time' }).click();
  await shot(signer, 'end-expired-asked', {
    area: 'signer-ends',
    caption: 'After asking for more time: the sender has been emailed.',
  });

  // The sender gives more time, and the expired banner is on screen meanwhile.
  const expiredBanner = sender.getByRole('region', { name: /Expired/i }).first();
  await expect(async () => {
    await sender.goto(`/dashboard/envelopes/${envelopeId}`);
    await expect(expiredBanner).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await shot(sender, 'expired-banner', {
    area: 'track',
    caption: "The sender's view of a paused document, with both ways out.",
    fullPage: true,
    mask: [sender.locator(HASHES)],
  });

  // Cancelled, as the signer sees it.
  await sender
    .getByRole('button', { name: /Cancel document|Cancel/ })
    .first()
    .click();
  const dialog = sender.getByRole('dialog');
  await dialog.getByLabel('Reason').fill('The terms changed; a new version is on its way.');
  await dialog.getByRole('button', { name: 'Cancel document' }).click();
  await expect(sender.getByRole('region', { name: 'Cancelled' })).toBeVisible({ timeout: 30_000 });
  await shot(sender, 'cancelled-banner', {
    area: 'track',
    caption: "The sender's cancelled document, with the reason recorded.",
    fullPage: true,
  });

  const voided = await emailFor(signerEmail, 'voided');
  expect(voided.to).toContain(signerEmail);

  await openAsSigner(signer, link);
  await shot(signer, 'end-cancelled', {
    area: 'signer-ends',
    caption: 'The signer opening a link for a document the sender cancelled.',
  });

  await signerContext.close();
});

test('the gallery index', async () => {
  const index = writeContactSheet();
  expect(index).toContain(GALLERY_DIR);
  expect(TEST_PASSWORD).toBeTruthy();
});

test('integration settings', async ({ page }) => {
  await signUpAs(page, 'gallery-integrations', SENDER);
  await page.goto('/settings/integrations');
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
  await shot(page, 'integrations-empty', {
    area: 'settings',
    caption: 'Integration settings before credentials are added.',
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Create API key' }).click();
  await shot(page, 'integrations-create-api-key', {
    area: 'settings',
    caption: 'Creating a labelled, optionally read-only API key.',
  });
  await page.getByLabel('Key label').fill('HealthProHub production');
  await page.getByRole('dialog').getByRole('button', { name: 'Create key' }).click();
  await expect(page.getByTestId('raw-api-key')).toBeVisible();
  await shot(page, 'integrations-api-key-once', {
    area: 'settings',
    caption: 'The API key is shown once.',
    mask: [page.getByTestId('raw-api-key')],
  });
  await page.getByRole('button', { name: 'I have saved the key' }).click();

  await page.getByRole('button', { name: 'Add webhook' }).click();
  await page.getByLabel('Choose events').check();
  await page.getByLabel('Envelope sent', { exact: true }).check();
  await shot(page, 'integrations-add-webhook', {
    area: 'settings',
    caption: 'Registering a webhook and choosing its events.',
  });
  await page.getByLabel('Endpoint URL').fill('http://127.0.0.1:9/gallery-hook');
  await page.getByLabel('Description (optional)').fill('HealthProHub production');
  await page.getByRole('dialog').getByRole('button', { name: 'Add webhook' }).click();
  await expect(page.getByTestId('raw-webhook-secret')).toBeVisible();
  await shot(page, 'integrations-webhook-secret-once', {
    area: 'settings',
    caption: 'The webhook signing secret is shown once.',
    mask: [page.getByTestId('raw-webhook-secret')],
  });
  await page.getByRole('button', { name: 'I have saved the secret' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'integrations-populated', {
    area: 'settings',
    caption: 'API keys and webhook endpoints after setup.',
    fullPage: true,
  });
  const galleryDb = new pg.Client({ connectionString: STACK_ENV.DIRECT_DATABASE_URL });
  await galleryDb.connect();
  try {
    await galleryDb.query(
      `INSERT INTO "WebhookDelivery" (id, "tenantId", "webhookEndpointId", "eventId", "eventType", payload, status, attempts, "lastAttemptAt", "lastStatusCode", "createdAt")
       SELECT gen_random_uuid(), "tenantId", id, 'evt_gallery', 'envelope.completed', '{"data":{"envelopeId":"gallery-envelope"}}'::jsonb, 'SUCCEEDED', 1, now(), 204, now()
       FROM "WebhookEndpoint" WHERE url = 'http://127.0.0.1:9/gallery-hook'`,
    );
  } finally {
    await galleryDb.end();
  }
  await page.getByRole('button', { name: 'Deliveries' }).click();
  await expect(
    page.getByRole('dialog').getByRole('listitem').getByText('Envelope completed'),
  ).toBeVisible();
  await shot(page, 'integrations-deliveries', {
    area: 'settings',
    caption: 'A successful webhook delivery with its status and attempt details.',
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page
    .getByLabel('Endpoint URL')
    .fill(`http://127.0.0.1:9/${'long-endpoint-path'.repeat(8)}`);
  await page.getByLabel('Description (optional)').clear();
  await shot(page, 'integrations-edit-webhook', {
    area: 'settings',
    caption: 'Editing a webhook with a long endpoint address.',
  });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await page.getByRole('button', { name: 'Deactivate webhook', exact: true }).click();
  await expect(page.getByText('Inactive', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke key', exact: true }).click();
  await expect(page.getByText('Revoked', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'integrations-inactive-long-content', {
    area: 'settings',
    caption: 'Revoked keys and inactive endpoints with long content.',
    fullPage: true,
  });

  const disabledDb = new pg.Client({ connectionString: STACK_ENV.DIRECT_DATABASE_URL });
  await disabledDb.connect();
  try {
    await disabledDb.query(
      `UPDATE "WebhookEndpoint"
          SET "disabledAt" = now(), "consecutiveFailures" = 3,
              "disabledReason" = 'Turned off automatically: 3 deliveries in a row failed every retry.'
        WHERE "isActive" = false`,
    );
  } finally {
    await disabledDb.end();
  }
  await page.reload();
  await expect(page.getByText('Turned off automatically', { exact: true })).toBeVisible();
  await shot(page, 'integrations-webhook-disabled', {
    area: 'settings',
    caption: 'An endpoint turned off automatically after repeated failures.',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Rotate secret', exact: true }).click();
  await shot(page, 'integrations-rotate-secret', {
    area: 'settings',
    caption: 'Choosing how long the old signing secret keeps working.',
  });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Rotate secret', exact: true })
    .click();
  await expect(page.getByTestId('rotated-webhook-secret')).toBeVisible();
  await shot(page, 'integrations-rotated-secret-once', {
    area: 'settings',
    caption: 'The new signing secret is shown once.',
    mask: [page.getByTestId('rotated-webhook-secret')],
  });
});

test('integration developer guide', async ({ page }) => {
  await signUpAs(page, 'gallery-integration-guide', SENDER);
  await page.goto('/settings/integrations');
  await page.getByRole('tab', { name: 'Integration guide', exact: true }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await shot(page, 'integration-guide-start', {
    area: 'settings',
    caption: 'Integration quick start and guided workflow.',
    fullPage: true,
  });
  await page.getByRole('tab', { name: 'API reference', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search API operations' }).fill('fields');
  await page.locator('summary').filter({ hasText: 'Place signing fields' }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await shot(page, 'integration-guide-api', {
    area: 'settings',
    caption: 'Searchable API reference with request and response examples.',
    fullPage: true,
  });
  await page.getByRole('tab', { name: 'Webhook guide', exact: true }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await shot(page, 'integration-guide-webhooks', {
    area: 'settings',
    caption: 'Webhook setup, event payloads, verification and acknowledgement.',
    fullPage: true,
  });
});

test('HealthProHub embedded editor', async ({ page, request }) => {
  const host = await createEmbedHost(request, 'upload');
  try {
    await page.goto(host.origin);
    await page.getByRole('button', { name: 'Prepare for signing' }).click();
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('heading', { name: 'Upload a document' })).toBeVisible();
    await shot(page, 'embedded-upload', {
      area: 'integration',
      caption: 'Existing Envelope upload UI inside the isolated HealthProHub host.',
      fullPage: false,
    });
    await frame.locator('input[type="file"]').setInputFiles(DEMO_AGREEMENT_PDF);
    await frame.getByRole('button', { name: 'Upload document', exact: true }).click();
    await expect(frame.getByRole('heading', { name: 'Prepare for signing' })).toBeVisible();
    await expect(frame.locator('[data-page-number="1"] canvas')).toBeVisible();
    await shot(page, 'embedded-prepare', {
      area: 'integration',
      caption: 'Reused PDF viewer and recipient/field panels inside HealthProHub.',
      fullPage: false,
    });
  } finally {
    await host.close();
  }
});

test('HealthProHub integration guide', async ({ page }) => {
  await signUpAs(page, 'gallery-healthprohub', SENDER);
  await page.goto('/settings/integrations');
  await page.getByRole('tab', { name: 'Integration guide', exact: true }).click();
  await page.getByRole('tab', { name: 'Embedded editor' }).click();
  await page.getByText('Direct iframe alternative', { exact: true }).click();
  await shot(page, 'healthprohub-guide', {
    area: 'integration',
    caption: 'Both editor entry modes, secure sessions, SDK and direct iframe examples.',
    fullPage: true,
  });
});
