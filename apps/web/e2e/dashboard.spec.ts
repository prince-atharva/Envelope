import { expect, test } from '@playwright/test';
import {
  passDeadline,
  prepareToSend,
  sendFromReview,
  signUp,
  TWELVE_PAGE_PDF,
  uniqueEmail,
  uploadDocument,
} from './helpers';

test.describe('Dashboard', () => {
  test('tabs with counts, opening on Needs attention when something needs it', async ({ page }) => {
    await signUp(page, 'dashboard');
    await uploadDocument(page, TWELVE_PAGE_PDF);
    const envelopeId = await prepareToSend(page, [
      { name: 'Priya Sharma', email: uniqueEmail('priya') },
    ]);
    await sendFromReview(page);

    // Nothing needs attention yet: it opens on All.
    await page.goto('/dashboard');
    const tabs = page.getByRole('tablist', { name: 'Document views' });
    await expect(tabs.getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: /^Drafts/ })).toContainText('1');
    await expect(tabs.getByRole('tab', { name: /^Waiting/ })).toContainText('1');

    // The deadline passes: the next visit opens on Needs attention.
    await passDeadline(envelopeId);
    await expect(async () => {
      await page.goto('/dashboard');
      await expect(tabs.getByRole('tab', { name: /^Needs attention/ })).toHaveAttribute(
        'aria-selected',
        'true',
        { timeout: 1000 },
      );
    }).toPass({ timeout: 20_000 });
    const list = page.getByTestId('envelope-list');
    await expect(list.getByText(/Expired .*give more time or cancel/)).toBeVisible();
    await expect(list.getByText('0 of 1 signed · Waiting on Priya Sharma')).toBeVisible();

    // Another tab, kept in the address.
    await tabs.getByRole('tab', { name: /^Drafts/ }).click();
    await expect(page).toHaveURL(/view=drafts/);
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list.getByText('Draft', { exact: true })).toBeVisible();
  });
});
