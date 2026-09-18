import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

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
  const target = pageBox(page, pageNumber);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`Page ${pageNumber} is not visible`);
  await page.mouse.click(box.x + box.width * at.xRatio, box.y + box.height * at.yRatio);
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
