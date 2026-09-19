import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import pg from 'pg';
import { OUTBOX_DIR, STACK_ENV } from './stack/stack.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const TWELVE_PAGE_PDF = resolve(here, 'fixtures/test-12-pages.pdf');
export const MIXED_PAGE_PDF = resolve(here, 'fixtures/mixed-pages.pdf');
export const TEST_PASSWORD = 'TestPassword123!';

export function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}+${Math.floor(Math.random() * 100_000)}@example.com`;
}

/** Registers a new account and lands on the dashboard. */
export async function signUp(page: Page, prefix: string): Promise<string> {
  const email = uniqueEmail(prefix);
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Builder Tester');
  await page.getByLabel('Organisation (optional)').fill('E2E Medical');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  return email;
}

/** Uploads a PDF and returns the new envelope's id. */
export async function uploadDocument(page: Page, pdfPath: string): Promise<string> {
  await page.goto('/dashboard/new');
  await page.locator('input[type="file"]').setInputFiles(pdfPath);
  const uploadButton = page.getByRole('button', { name: 'Upload document' });
  await expect(uploadButton).toBeEnabled({ timeout: 10_000 });
  await uploadButton.click();
  await expect(page).toHaveURL(/\/dashboard\/envelopes\/[0-9a-f-]+/, { timeout: 30_000 });
  const id = new URL(page.url()).pathname.split('/').pop();
  if (!id) throw new Error(`No envelope id in ${page.url()}`);
  return id;
}

export async function addRecipient(page: Page, name: string, email: string): Promise<void> {
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByText(email)).toBeVisible({ timeout: 10_000 });
}

/** The page wrapper element for one page of the viewer. */
export function pageBox(page: Page, pageNumber: number) {
  return page.locator(`[data-page-number="${pageNumber}"]`);
}

/** Places an armed field type at a point given as a fraction of the page. */
export async function placeField(
  page: Page,
  fieldLabel: string,
  pageNumber: number,
  at: { xRatio: number; yRatio: number },
): Promise<void> {
  await page.getByRole('button', { name: fieldLabel, exact: true }).click();
  // Bring the point itself to the middle of the screen, scrolling the viewer
  // and the window as needed. Scrolling the page into view is not enough: a
  // page taller than the viewer is centred as a whole, which can leave the
  // point above or below what is on screen. A 1px marker at the point lets the
  // browser do the scrolling, and says where to click.
  const point = await pageBox(page, pageNumber).evaluate((element, where) => {
    const marker = document.createElement('div');
    marker.style.cssText = `position:absolute;left:${where.xRatio * 100}%;top:${
      where.yRatio * 100
    }%;width:1px;height:1px;pointer-events:none`;
    element.append(marker);
    marker.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = marker.getBoundingClientRect();
    marker.remove();
    return { x: rect.left, y: rect.top };
  }, at);
  await page.mouse.click(point.x, point.y);
}

/** Where a field sits relative to its page, as fractions, measured from the DOM. */
export async function fieldPosition(
  page: Page,
  fieldIndex: number,
): Promise<{ xRatio: number; yRatio: number; widthRatio: number }> {
  const field = page.locator('[data-field-id]').nth(fieldIndex);
  const fieldBox = await field.boundingBox();
  const pageNumber = await field.evaluate(
    (element) => element.closest('[data-page-number]')?.getAttribute('data-page-number') ?? '1',
  );
  const box = await pageBox(page, Number(pageNumber)).boundingBox();
  if (!fieldBox || !box) throw new Error('Field or page is not visible');
  return {
    xRatio: (fieldBox.x - box.x) / box.width,
    yRatio: (fieldBox.y - box.y) / box.height,
    widthRatio: fieldBox.width / box.width,
  };
}

export interface SavedField {
  id: string;
  pageNumber: number;
  ratioX: number;
  ratioY: number;
  ratioWidth: number;
  ratioHeight: number;
}

/**
 * Records the layout of every save the page sends.
 *
 * The API is called with an access token held in the page's memory, so a
 * test-side request cannot read the envelope back. Watching the save request
 * instead shows exactly the numbers that reach the server, which is what the
 * zoom-independence check needs to compare.
 */
export function recordSaves(page: Page): { last: () => SavedField[] | null } {
  let latest: SavedField[] | null = null;
  page.on('request', (request) => {
    if (request.method() !== 'PUT' || !request.url().includes('/fields')) return;
    const body = request.postDataJSON() as { fields?: SavedField[] } | null;
    if (body?.fields) latest = body.fields;
  });
  return { last: () => latest };
}

/**
 * Waits until a layout with `expectedCount` fields has actually been saved.
 *
 * Watching the "Saved" label is not enough: it is still showing from the
 * previous save, so a test would walk straight past a save that has not
 * happened yet and then read a stale layout.
 */
export async function waitForFieldsSaved(page: Page, expectedCount: number): Promise<void> {
  await page.waitForResponse(
    async (response) => {
      if (response.request().method() !== 'PUT' || !response.url().includes('/fields')) {
        return false;
      }
      if (!response.ok()) return false;
      const body = (await response.json()) as { fields: unknown[] };
      return body.fields.length === expectedCount;
    },
    { timeout: 20_000 },
  );
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });
}

/** Picks whose fields the next placements belong to, in the builder's people list. */
export async function selectRecipient(page: Page, name: string): Promise<void> {
  await page.locator('button[aria-pressed]').filter({ hasText: name }).click();
}

export interface Person {
  name: string;
  email: string;
}

/**
 * Uploads a document and prepares it for the given people: each gets a
 * signature and a tick box on page 1. Returns the envelope id, on the review
 * screen, ready to send.
 */
export async function prepareToSend(
  page: Page,
  people: Person[],
  options: { oneAfterAnother?: boolean } = {},
): Promise<string> {
  const envelopeId = await uploadDocument(page, TWELVE_PAGE_PDF);
  await page.getByRole('link', { name: 'Prepare for signing' }).click();
  for (const person of people) await addRecipient(page, person.name, person.email);
  if (options.oneAfterAnother) {
    await page.getByRole('radio', { name: 'One after another' }).click();
    await expect(page.getByRole('radio', { name: 'One after another' })).toBeChecked();
  }

  // A click on a page that has not rendered yet has no page size to convert
  // with, so the builder ignores it.
  await page.getByLabel('Zoom Level').selectOption('1');
  await expect(page.locator('[data-pdf-overlay="1"]')).toBeAttached({ timeout: 20_000 });

  let placed = 0;
  for (const [index, person] of people.entries()) {
    await selectRecipient(page, person.name);
    const x = 0.15 + index * 0.35;
    await placeField(page, 'Signature', 1, { xRatio: x, yRatio: 0.3 });
    placed += 1;
    await waitForFieldsSaved(page, placed);
    await placeField(page, 'Tick box', 1, { xRatio: x, yRatio: 0.45 });
    placed += 1;
    await waitForFieldsSaved(page, placed);
  }

  await page.getByRole('link', { name: 'Review' }).click();
  await expect(page).toHaveURL(new RegExp(`/envelopes/${envelopeId}/review$`));
  return envelopeId;
}

/** The outbox's messages. Attachments sit beside them as their own files. */
export async function outboxMessages(): Promise<string[]> {
  const files = await readdir(OUTBOX_DIR).catch(() => [] as string[]);
  return files.filter((file) => file.endsWith('.json')).sort();
}

export interface OutboxEmail {
  to: string;
  template: string;
  text: string;
  sentAt: string;
}

/**
 * The newest signing link emailed to this address, read from the isolated
 * stack's file outbox (stack.mjs). Waits for the email worker, which sends
 * after the request that queued it has returned.
 */
export async function signingLinkFor(email: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = (await outboxMessages()).reverse();
    for (const file of files) {
      const message = JSON.parse(await readFile(join(OUTBOX_DIR, file), 'utf8')) as OutboxEmail;
      if (
        message.to !== email ||
        !['invitation', 'reminder', 'extended'].includes(message.template)
      )
        continue;
      const link = /https?:\/\/\S+\/sign\/[0-9a-f]{64}/.exec(message.text)?.[0];
      if (link) return link;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`No signing link was emailed to ${email}`);
}

/** The newest email of one template to this address, from the outbox. */
export async function emailFor(
  email: string,
  template: string,
  timeoutMs = 20_000,
): Promise<OutboxEmail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const file of (await outboxMessages()).reverse()) {
      const message = JSON.parse(await readFile(join(OUTBOX_DIR, file), 'utf8')) as OutboxEmail;
      if (message.to === email && message.template === template) return message;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`No ${template} email was sent to ${email}`);
}

export interface CompletedCopy {
  /** Path of the attached sealed PDF in the outbox. */
  file: string;
  /** The fingerprint the email gives for it. */
  sha256: string;
}

/**
 * The finished document emailed to this address once everyone has signed
 * (docs/15 step 6): the attachment the outbox wrote beside the message.
 */
export async function completedCopyFor(email: string, timeoutMs = 30_000): Promise<CompletedCopy> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const name of (await outboxMessages()).reverse()) {
      const message = JSON.parse(await readFile(join(OUTBOX_DIR, name), 'utf8')) as OutboxEmail & {
        attachments?: { file: string }[];
      };
      if (message.to !== email || message.template !== 'completed') continue;
      const attached = message.attachments?.[0]?.file;
      const sha256 = /\b[0-9a-f]{64}\b/.exec(message.text)?.[0];
      if (attached && sha256) return { file: join(OUTBOX_DIR, attached), sha256 };
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`No completed document was emailed to ${email}`);
}

/** Every signing token emailed so far in this run, from any email in the outbox. */
export async function allSigningTokens(): Promise<string[]> {
  const tokens = new Set<string>();
  for (const file of await outboxMessages()) {
    const message = await readFile(join(OUTBOX_DIR, file), 'utf8');
    for (const match of message.matchAll(/\/sign\/([0-9a-f]{64})/g)) {
      if (match[1]) tokens.add(match[1]);
    }
  }
  return [...tokens];
}

/** Sends the envelope on the review screen, with the dialog's defaults. */
export async function sendFromReview(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Send for signing' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(/^Sent\./)).toBeVisible({ timeout: 15_000 });
}

/**
 * Opens a signing link as the signer would: from an email, with no sender
 * session in the browser.
 */
export async function openAsSigner(page: Page, link: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto(link);
}

/** Ticks the notice and continues to the document. */
export async function agreeToSign(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: 'Agreement to sign electronically' }),
  ).toBeVisible();
  await page.getByLabel('I agree to sign electronically').check();
  await page.getByRole('button', { name: 'Review document' }).click();
  await expect(page.locator('[data-pdf-overlay="1"]')).toBeAttached({ timeout: 20_000 });
}

/**
 * Signs as the only signer of a `prepareToSend` envelope: agree, adopt the
 * typed signature, tick the box and finish.
 */
export async function signOnlyBoxes(page: Page, link: string): Promise<void> {
  await openAsSigner(page, link);
  await agreeToSign(page);
  await page.getByRole('button', { name: /^Signature field, required, page 1 of 12/ }).click();
  await page
    .getByRole('dialog', { name: 'Adopt your signature' })
    .getByRole('button', { name: 'Adopt and sign' })
    .click();
  await page.getByRole('checkbox', { name: 'Tick box field, required, page 1 of 12' }).check();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('heading', { name: 'Signed' })).toBeVisible();
}

/**
 * Moves an envelope's deadline into the past, straight in the stack's test
 * database. The stack's expiry sweep (every 2 seconds) then pauses it.
 */
export async function passDeadline(envelopeId: string): Promise<void> {
  const client = new pg.Client({ connectionString: STACK_ENV.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `UPDATE "Envelope" SET "expiresAt" = now() AT TIME ZONE 'UTC' - interval '1 minute'
        WHERE id = $1`,
      [envelopeId],
    );
  } finally {
    await client.end();
  }
}
