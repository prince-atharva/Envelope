import { expect, test } from '@playwright/test';
import { openNavigation, prepareToSend, sendFromReview, signUp, uniqueEmail } from './helpers';

test.describe('Reports (docs/22 step 10)', () => {
  test('an owner sees what was sent, and can change the period', async ({ page }) => {
    await signUp(page, 'reports-owner');
    await prepareToSend(page, [{ name: 'Priya Sharma', email: uniqueEmail('priya') }]);
    await sendFromReview(page);

    await openNavigation(page);
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

    const totals = page.getByRole('region', { name: 'Totals' });
    await expect(totals.getByText('Sent', { exact: true })).toBeVisible();
    await expect(totals.getByText('1', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'Signer funnel' })).toContainText('Invited');

    await page.getByRole('button', { name: 'Last 7 days' }).click();
    await expect(page.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // The same numbers are available as tables.
    await page.getByText('View the numbers as tables').click();
    await expect(page.getByRole('table', { name: 'Signer funnel' })).toBeVisible();
  });

  test('a range longer than a year is refused before anything is asked of the server', async ({
    page,
  }) => {
    await signUp(page, 'reports-range');
    await page.goto('/reports');
    await page.getByRole('button', { name: 'Custom range' }).click();
    await page.getByLabel('From').fill('2024-01-01');
    await expect(page.getByText('Choose a range of at most 366 days.')).toBeVisible();
  });
});
