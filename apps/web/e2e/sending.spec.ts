import { expect, test } from '@playwright/test';
import { prepareToSend, signUp, uniqueEmail } from './helpers';

test.describe('Sending', () => {
  test('send one after another, then follow each person and remind them', async ({ page }) => {
    await signUp(page, 'sender');
    const priya = { name: 'Priya Sharma', email: uniqueEmail('priya') };
    const raj = { name: 'Raj Patel', email: uniqueEmail('raj') };
    const envelopeId = await prepareToSend(page, [priya, raj], { oneAfterAnother: true });

    await page.getByRole('button', { name: 'Send for signing' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Emailed now: Priya Sharma')).toBeVisible();
    await expect(dialog.getByText(/Then, one after another: Raj Patel/)).toBeVisible();
    await dialog.getByLabel('Links stop working after').selectOption('7');
    await dialog.getByLabel(/Message in the email/).fill('Please sign by Friday.');
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/dashboard/envelopes/${envelopeId}$`));
    await expect(
      page.getByText('Sent. We are emailing Priya Sharma a link to sign.'),
    ).toBeVisible();

    const progress = page.getByRole('region', { name: 'Signing progress' });
    const priyaRow = progress.getByRole('listitem').filter({ hasText: priya.email });
    const rajRow = progress.getByRole('listitem').filter({ hasText: raj.email });
    await expect(priyaRow.getByText(/Email sent|Sending email…/)).toBeVisible();
    await expect(rajRow.getByText('Waiting for their turn')).toBeVisible();
    // Not their turn yet, so nothing to remind them about.
    await expect(rajRow.getByRole('button', { name: /reminder/ })).toHaveCount(0);

    await priyaRow.getByRole('button', { name: 'Send a reminder to Priya Sharma' }).click();
    await expect(priyaRow.getByText(/Reminder sent|Reminded/)).toBeVisible();

    // A sent document can no longer be prepared or reviewed.
    await page.goto(`/dashboard/envelopes/${envelopeId}/prepare`);
    await expect(page).toHaveURL(new RegExp(`/dashboard/envelopes/${envelopeId}$`));
    await page.goto(`/dashboard/envelopes/${envelopeId}/review`);
    await expect(page).toHaveURL(new RegExp(`/dashboard/envelopes/${envelopeId}$`));
  });
});
