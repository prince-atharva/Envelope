import { expect, test } from '@playwright/test';
import {
  addRecipient,
  fieldPosition,
  MIXED_PAGE_PDF,
  openPreparePanel,
  pageBox,
  placeField,
  recordSaves,
  selectRecipient,
  signUp,
  TWELVE_PAGE_PDF,
  uploadDocument,
  waitForFieldsSaved,
} from './helpers';

test.describe('Field builder', () => {
  test('place fields for two people, reload, and find them unmoved', async ({ page }) => {
    await signUp(page, 'builder');
    const envelopeId = await uploadDocument(page, TWELVE_PAGE_PDF);

    await page.getByRole('link', { name: 'Prepare for signing' }).click();
    await expect(page).toHaveURL(/\/prepare$/);
    await expect(page.getByRole('heading', { name: 'Prepare for signing' })).toBeVisible();

    await addRecipient(page, 'Priya Sharma', 'priya@example.com');
    await addRecipient(page, 'Raj Patel', 'raj@example.com');

    // Fields go to whoever is selected, so pick Priya before placing hers.
    await selectRecipient(page, 'Priya Sharma');
    await placeField(page, 'Signature', 1, { xRatio: 0.3, yRatio: 0.4 });
    await waitForFieldsSaved(page, 1);

    await selectRecipient(page, 'Raj Patel');
    await placeField(page, 'Date', 3, { xRatio: 0.5, yRatio: 0.25 });
    await waitForFieldsSaved(page, 2);

    await expect(page.locator('[data-field-id]')).toHaveCount(2);
    const before = [await fieldPosition(page, 0), await fieldPosition(page, 1)];

    await page.reload();
    await expect(page.locator('[data-field-id]')).toHaveCount(2, { timeout: 20_000 });
    const after = [await fieldPosition(page, 0), await fieldPosition(page, 1)];

    for (const [index, position] of after.entries()) {
      const original = before[index];
      if (!original) throw new Error('missing position');
      expect(Math.abs(position.xRatio - original.xRatio)).toBeLessThan(0.002);
      expect(Math.abs(position.yRatio - original.yRatio)).toBeLessThan(0.002);
      expect(Math.abs(position.widthRatio - original.widthRatio)).toBeLessThan(0.002);
    }

    // Each box names its recipient, so colour is never the only cue.
    await expect(page.getByText('Priya Sharma · Signature')).toBeVisible();
    await expect(page.getByText('Raj Patel · Date')).toBeVisible();

    await page.getByRole('link', { name: 'Review' }).click();
    await expect(page).toHaveURL(new RegExp(`/envelopes/${envelopeId}/review$`));
    await expect(page.getByText('1 signature on page 1')).toBeVisible();
    await expect(page.getByText('1 date on page 3')).toBeVisible();
    // Both people have a required field, so the draft is ready to send.
    await expect(page.getByRole('button', { name: 'Send for signing' })).toBeEnabled();
  });

  test('stores identical positions whether the work is done at 100% or 200%', async ({ page }) => {
    const saves = recordSaves(page);
    await signUp(page, 'zoom');

    async function placeAtZoom(zoom: string) {
      await uploadDocument(page, TWELVE_PAGE_PDF);
      await page.getByRole('link', { name: 'Prepare for signing' }).click();
      await addRecipient(page, 'Zoom Tester', `zoom-${zoom}-${Date.now()}@example.com`);

      await page.getByLabel('Zoom Level').selectOption(zoom);
      await placeField(page, 'Signature', 1, { xRatio: 0.3, yRatio: 0.35 });

      // Keyboard nudges, so both runs move by exactly the same number of points
      // no matter how many pixels that is on screen.
      for (let i = 0; i < 3; i += 1) {
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowDown');
      }
      await waitForFieldsSaved(page, 1);
      return saves.last();
    }

    const atNormal = await placeAtZoom('1');
    const atDouble = await placeAtZoom('2');

    expect(atNormal).toHaveLength(1);
    expect(atDouble).toHaveLength(1);
    const first = atNormal?.[0];
    const second = atDouble?.[0];
    if (!first || !second) throw new Error('no saved field');

    // Byte-identical, not merely close: the exit criterion for this phase.
    expect(second.ratioX).toBe(first.ratioX);
    expect(second.ratioY).toBe(first.ratioY);
    expect(second.ratioWidth).toBe(first.ratioWidth);
    expect(second.ratioHeight).toBe(first.ratioHeight);
  });

  test('arrow keys nudge the selected field without turning the page', async ({ page }) => {
    await signUp(page, 'nudge');
    await uploadDocument(page, TWELVE_PAGE_PDF);
    await page.getByRole('link', { name: 'Prepare for signing' }).click();
    await addRecipient(page, 'Nudge Tester', `nudge-${Date.now()}@example.com`);

    await page.getByLabel('Zoom Level').selectOption('1');
    await placeField(page, 'Signature', 1, { xRatio: 0.3, yRatio: 0.4 });
    await waitForFieldsSaved(page, 1);

    const pageIndicator = page.getByLabel('Current Page Number');
    const startPage = await pageIndicator.inputValue();
    const start = await fieldPosition(page, 0);

    for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');

    const moved = await fieldPosition(page, 0);
    expect(moved.xRatio).toBeGreaterThan(start.xRatio);
    await expect(pageIndicator).toHaveValue(startPage);
  });

  test('keeps fields aligned on rotated and differently sized pages', async ({ page }) => {
    await signUp(page, 'mixed');
    await uploadDocument(page, MIXED_PAGE_PDF);
    await page.getByRole('link', { name: 'Prepare for signing' }).click();
    await addRecipient(page, 'Mixed Tester', `mixed-${Date.now()}@example.com`);

    const saves = recordSaves(page);
    await page.getByLabel('Zoom Level').selectOption('1');

    // The landscape page and the rotated page: both are wider than they are
    // tall on screen, and a field must land where it was put on each.
    let placed = 0;
    for (const pageNumber of [2, 3]) {
      await placeField(page, 'Signature', pageNumber, { xRatio: 0.25, yRatio: 0.5 });
      placed += 1;
      await waitForFieldsSaved(page, placed);
    }

    const saved = saves.last();
    expect(saved).toHaveLength(2);

    for (const field of saved ?? []) {
      const box = await pageBox(page, field.pageNumber).boundingBox();
      const rendered = await page.locator(`[data-field-id="${field.id}"]`).boundingBox();
      if (!box || !rendered) throw new Error(`page ${field.pageNumber} not visible`);

      // What is on screen matches the stored ratio, within a pixel.
      expect(Math.abs(rendered.x - box.x - field.ratioX * box.width)).toBeLessThan(1.5);
      expect(Math.abs(rendered.y - box.y - field.ratioY * box.height)).toBeLessThan(1.5);
      expect(Math.abs(rendered.width - field.ratioWidth * box.width)).toBeLessThan(1.5);
    }
  });

  test('signing one after another, in an order the sender can change', async ({ page }) => {
    await signUp(page, 'order');
    const envelopeId = await uploadDocument(page, TWELVE_PAGE_PDF);
    await page.getByRole('link', { name: 'Prepare for signing' }).click();
    await addRecipient(page, 'Priya Sharma', `priya-${Date.now()}@example.com`);
    await addRecipient(page, 'Raj Patel', `raj-${Date.now()}@example.com`);

    // Everyone at once is the default, and it shows no order.
    await expect(page.getByRole('radio', { name: 'Everyone at once' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Move Raj Patel up' })).toHaveCount(0);

    // The choice is saved before the radio shows it, so wait rather than check().
    await page.getByRole('radio', { name: 'One after another' }).click();
    await expect(page.getByRole('radio', { name: 'One after another' })).toBeChecked();
    await expect(page.getByText('1. Priya Sharma')).toBeVisible();
    await expect(page.getByText('2. Raj Patel')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Move Priya Sharma up' })).toBeDisabled();

    await page.getByRole('button', { name: 'Move Raj Patel up' }).click();
    await expect(page.getByText('1. Raj Patel')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('2. Priya Sharma')).toBeVisible();

    // The order is saved, not just shown.
    await page.reload();
    await openPreparePanel(page, 'recipients');
    await expect(page.getByRole('radio', { name: 'One after another' })).toBeChecked();
    await expect(page.getByText('1. Raj Patel')).toBeVisible({ timeout: 10_000 });

    await page.goto(`/dashboard/envelopes/${envelopeId}/review`);
    await expect(page.getByText('One after another: Raj Patel, then Priya Sharma')).toBeVisible();
  });

  test('a person who only gets a copy cannot hold fields', async ({ page }) => {
    await signUp(page, 'roles');
    await uploadDocument(page, TWELVE_PAGE_PDF);
    await page.getByRole('link', { name: 'Prepare for signing' }).click();
    await addRecipient(page, 'Copy Only', `copy-${Date.now()}@example.com`);

    await placeField(page, 'Signature', 1, { xRatio: 0.3, yRatio: 0.4 });
    await waitForFieldsSaved(page, 1);
    await expect(page.locator('[data-field-id]')).toHaveCount(1);

    // The confirmation is ours now, not the browser's, so it is clicked rather
    // than handled through page.on('dialog').
    await openPreparePanel(page, 'recipients');
    await page.getByLabel('Role for Copy Only').selectOption('CC');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Change role and remove/ })
      .click();

    await expect(page.locator('[data-field-id]')).toHaveCount(0, { timeout: 15_000 });
  });
});
