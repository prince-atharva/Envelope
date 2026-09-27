import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { signUp, TEST_PASSWORD } from './helpers';
import { STACK_ENV } from './stack/stack.mjs';

let receiver: Server | undefined;
test.afterEach(async () => {
  if (receiver?.listening) await new Promise<void>((resolve) => receiver?.close(() => resolve()));
  receiver = undefined;
});

async function setRole(email: string, role: 'ADMIN' | 'MEMBER'): Promise<void> {
  const client = new pg.Client({ connectionString: STACK_ENV.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query('UPDATE "User" SET role = $1 WHERE email = $2', [role, email]);
  } finally {
    await client.end();
  }
}

async function signIn(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test('owner manages API keys, webhooks and a failed delivery', async ({ page }) => {
  receiver = createServer((_request, response) => {
    response.writeHead(204);
    response.end();
  });
  await new Promise<void>((resolve, reject) =>
    receiver?.listen(0, '127.0.0.1', resolve).once('error', reject),
  );
  const address = receiver.address();
  if (!address || typeof address === 'string')
    throw new Error('Local webhook receiver did not bind');
  const endpointUrl = `http://127.0.0.1:${address.port}/integrations`;

  await signUp(page, 'integrations-owner');
  await page.goto('/settings/integrations');
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();

  await page.getByRole('button', { name: 'Create API key' }).click();
  await page.getByLabel('Key label').fill('HealthProHub production');
  await page.getByLabel('Read-only key').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Create key' }).click();
  await expect(page.getByTestId('raw-api-key')).toContainText(/^eak_/);
  await page.getByRole('button', { name: 'I have saved the key' }).click();
  const keyRow = page.getByRole('listitem').filter({ hasText: 'HealthProHub production' });
  await expect(keyRow).toContainText('Read only');
  await keyRow.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke key' }).click();
  await expect(keyRow).toContainText('Revoked');

  await page.getByRole('button', { name: 'Create API key' }).click();
  await page.getByLabel('Key label').fill('Reporting service');
  await page.getByRole('dialog').getByRole('button', { name: 'Create key' }).click();
  await page.getByRole('button', { name: 'I have saved the key' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Reporting service' })).toContainText(
    'Full access',
  );
  await page.getByRole('button', { name: 'Create API key' }).click();
  await expect(page.getByTestId('raw-api-key')).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Add webhook' }).click();
  await page.getByLabel('Endpoint URL').fill(endpointUrl);
  await page.getByLabel('Description (optional)').fill('HealthProHub receiver');
  await page.getByLabel('Choose events').check();
  await page.getByLabel('Envelope sent').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Add webhook' }).click();
  await expect(page.getByTestId('raw-webhook-secret')).toContainText(/^whsec_/);
  await page.getByRole('button', { name: 'I have saved the secret' }).click();
  let endpointRow = page.getByRole('listitem').filter({ hasText: 'HealthProHub receiver' });
  await expect(endpointRow).toContainText('Envelope sent');

  await endpointRow.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('raw-webhook-secret')).toHaveCount(0);
  await page.getByLabel('Description (optional)').clear();
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
  endpointRow = page
    .getByRole('listitem')
    .filter({ has: page.getByText(endpointUrl, { exact: true }) });
  await expect(endpointRow).not.toContainText('HealthProHub receiver');

  await page.getByRole('button', { name: 'Add webhook' }).click();
  await page.getByLabel('Endpoint URL').fill(`${endpointUrl}/all`);
  await page.getByLabel('Description (optional)').fill('All events receiver');
  await page.getByRole('dialog').getByRole('button', { name: 'Add webhook' }).click();
  await page.getByRole('button', { name: 'I have saved the secret' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'All events receiver' })).toContainText(
    'All available events',
  );

  const client = new pg.Client({ connectionString: STACK_ENV.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "WebhookDelivery" (id, "tenantId", "webhookEndpointId", "eventId", "eventType", payload, status, attempts, "lastAttemptAt", "lastError", "createdAt")
       SELECT gen_random_uuid(), "tenantId", id, $1, 'envelope.sent', $2::jsonb, 'EXHAUSTED', 6, now(), 'Receiver refused the connection', now()
       FROM "WebhookEndpoint" WHERE url = $3`,
      [
        `evt_ui_${Date.now()}`,
        JSON.stringify({ data: { envelopeId: 'browser-fixture' } }),
        endpointUrl,
      ],
    );
  } finally {
    await client.end();
  }

  await endpointRow.getByRole('button', { name: 'Deliveries' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Receiver refused the connection')).toBeVisible();
  await dialog.getByText('Event data').click();
  await expect(dialog.getByText(/browser-fixture/)).toBeVisible();
  const retryResponse = page.waitForResponse(
    (response) => response.url().includes('/redrive') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect((await retryResponse).ok()).toBeTruthy();
  await expect(dialog.getByText('Delivered')).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();

  await endpointRow.getByRole('button', { name: 'Deactivate' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Deactivate webhook' }).click();
  await expect(endpointRow).toContainText('Inactive');
  await endpointRow.getByRole('button', { name: 'Reactivate' }).click();
  await expect(endpointRow).toContainText('Active');
});

test('settings routes follow the Admin and Member role floor', async ({ page }) => {
  const adminEmail = await signUp(page, 'integrations-admin');
  await setRole(adminEmail, 'ADMIN');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, adminEmail);
  await page.goto('/settings/integrations');
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
  await page.goto('/settings/users');
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole('button', { name: 'Sign out' }).click();

  const memberEmail = await signUp(page, 'integrations-member');
  await setRole(memberEmail, 'MEMBER');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, memberEmail);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await page.goto('/settings/integrations');
  await expect(page).toHaveURL(/\/dashboard/);
});
