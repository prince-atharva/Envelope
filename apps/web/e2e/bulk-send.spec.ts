import { expect, test } from '@playwright/test';
import { prepareToSend, signingLinkFor, signUp, uniqueEmail } from './helpers';

test.describe('Bulk send', () => {
  test('send a template to a spreadsheet of people, leaving out the row with a problem', async ({
    page,
  }) => {
    await signUp(page, 'bulk-admin');
    const priya = { name: 'Priya Sharma', email: uniqueEmail('priya') };
    const envelopeId = await prepareToSend(page, [priya]);
    await page.goto(`/dashboard/envelopes/${envelopeId}`);
    await page.getByRole('button', { name: 'Save as template' }).click();
    const save = page.getByRole('dialog', { name: 'Save as template' });
    await save.getByLabel('Template name').fill('Clinic intake');
    await save.getByLabel('Role for Priya Sharma').fill('Patient');
    await save.getByRole('button', { name: 'Save template' }).click();
    await expect(page).toHaveURL(/\/templates$/);

    await page.getByRole('link', { name: 'Send to many' }).click();
    await expect(
      page.getByRole('heading', { name: /Send “Clinic intake” to many people/ }),
    ).toBeVisible();

    // The blank spreadsheet has exactly the columns the template needs.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download a blank spreadsheet' }).click();
    expect((await download).suggestedFilename()).toBe('Clinic intake.csv');

    const first = uniqueEmail('first');
    const second = uniqueEmail('second');
    const csv = [
      'Patient name,Patient email,externalId',
      `Alex Morgan,${first},visit:1`,
      'Broken Row,not-an-email,visit:2',
      `"Lee, Jordan",${second},visit:3`,
    ].join('\r\n');
    await page.getByLabel('Spreadsheet (CSV)').setInputFiles({
      name: 'people.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });

    await expect(page.getByText('2 of 3 rows are ready; 1 need fixing.')).toBeVisible();
    const table = page.getByRole('table', { name: 'Rows in the spreadsheet' });
    await expect(table.getByRole('row', { name: /Broken Row/ })).toHaveCount(0);
    await expect(table.getByText('Patient: enter a valid email address')).toBeVisible();
    await expect(table.getByText('Lee, Jordan')).toBeVisible();

    // Nothing is sent while a row is wrong, unless it is left out.
    const start = page.getByRole('button', { name: /^(Make|Send) \d+ (drafts|documents)$/ });
    await expect(start).toBeDisabled();
    await page.getByLabel(/Leave out the 1 row with problems/).check();
    await page.getByLabel('Send each document for signing as soon as it is made').check();
    await expect(page.getByRole('button', { name: 'Send 2 documents' })).toBeEnabled();
    await page.getByRole('button', { name: 'Send 2 documents' }).click();

    await expect(page).toHaveURL(/\/bulk-batches\/[0-9a-f-]+$/);
    await expect(page.getByRole('status').filter({ hasText: 'All 2 sent' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('link', { name: 'Sent: open the document' })).toHaveCount(2);
    await signingLinkFor(first);
    await signingLinkFor(second);

    // One of the documents, opened from the results.
    await page.getByRole('link', { name: 'Sent: open the document' }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/envelopes\/[0-9a-f-]+$/);

    // The batch is listed, and the template page leads to the list.
    await page.goto('/templates');
    await page.getByRole('link', { name: 'Bulk sends' }).click();
    await expect(page).toHaveURL(/\/bulk-batches$/);
    await expect(page.getByRole('link', { name: /Clinic intake.*All 2 sent/ })).toBeVisible();
  });

  test('refuses a file that is missing a column, and one with nothing in it', async ({ page }) => {
    await signUp(page, 'bulk-files');
    const envelopeId = await prepareToSend(page, [
      { name: 'Priya Sharma', email: uniqueEmail('priya') },
    ]);
    await page.goto(`/dashboard/envelopes/${envelopeId}`);
    await page.getByRole('button', { name: 'Save as template' }).click();
    await page
      .getByRole('dialog', { name: 'Save as template' })
      .getByRole('button', { name: 'Save template' })
      .click();
    await expect(page).toHaveURL(/\/templates$/);
    await page.getByRole('link', { name: 'Send to many' }).click();

    const file = page.getByLabel('Spreadsheet (CSV)');
    await file.setInputFiles({
      name: 'wrong.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Name,Email\nA,a@example.com\n'),
    });
    await expect(page.getByText(/The column “.* name” is missing\./)).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Make|Send) \d+/ })).toHaveCount(0);

    await file.setInputFiles({ name: 'empty.csv', mimeType: 'text/csv', buffer: Buffer.from('') });
    await expect(page.getByText(/The file is empty/)).toBeVisible();
  });
});
