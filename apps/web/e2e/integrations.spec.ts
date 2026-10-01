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
  expect(
    (await page.getByRole('button', { name: 'Copy API key' }).boundingBox())?.height,
  ).toBeGreaterThanOrEqual(44);
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
  expect(
    (await page.getByRole('button', { name: 'Copy signing secret' }).boundingBox())?.height,
  ).toBeGreaterThanOrEqual(44);
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
    (response) => response.url().includes('/retry') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect((await retryResponse).ok()).toBeTruthy();
  await expect(dialog.getByRole('listitem').getByText('Delivered')).toBeVisible({
    timeout: 10_000,
  });
  await expect(dialog.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();

  await endpointRow.getByRole('button', { name: 'Deactivate' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Deactivate webhook' }).click();
  await expect(endpointRow).toContainText('Inactive');
  await endpointRow.getByRole('button', { name: 'Reactivate' }).click();
  await expect(endpointRow).toContainText('Active');
});

test('the deliveries dialog filters by status and event, copies ids, and pages (docs/18 workstream 8 step 8.5)', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signUp(page, 'integrations-deliveries');
  await page.goto('/settings/integrations');

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
  const endpointUrl = `http://127.0.0.1:${address.port}/deliveries-filter`;

  await page.getByRole('button', { name: 'Add webhook' }).click();
  await page.getByLabel('Endpoint URL').fill(endpointUrl);
  await page.getByRole('dialog').getByRole('button', { name: 'Add webhook' }).click();
  await page.getByRole('button', { name: 'I have saved the secret' }).click();
  const endpointRow = page.getByRole('listitem').filter({ hasText: endpointUrl });

  const envelopeId = '11111111-1111-4111-8111-111111111111';
  const eventId = `evt_filter_${Date.now()}`;
  const client = new pg.Client({ connectionString: STACK_ENV.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "WebhookDelivery"
         (id, "tenantId", "webhookEndpointId", "eventId", "eventType", "envelopeId", payload, status, attempts, "lastAttemptAt", "createdAt")
       SELECT gen_random_uuid(), "tenantId", id, $1, 'envelope.sent', $2::uuid, $3::jsonb, 'SUCCEEDED', 1, now(), now()
       FROM "WebhookEndpoint" WHERE url = $4`,
      [eventId, envelopeId, JSON.stringify({ data: { envelopeId } }), endpointUrl],
    );
    await client.query(
      `INSERT INTO "WebhookDelivery"
         (id, "tenantId", "webhookEndpointId", "eventId", "eventType", payload, status, attempts, "lastAttemptAt", "lastError", "createdAt")
       SELECT gen_random_uuid(), "tenantId", id, $1, 'envelope.voided', $2::jsonb, 'EXHAUSTED', 7, now(), 'Receiver refused the connection', now()
       FROM "WebhookEndpoint" WHERE url = $3`,
      [
        `evt_filter2_${Date.now()}`,
        JSON.stringify({ data: { envelopeId: 'another-envelope' } }),
        endpointUrl,
      ],
    );
  } finally {
    await client.end();
  }

  await endpointRow.getByRole('button', { name: 'Deliveries' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('listitem')).toHaveCount(2);

  await dialog.getByLabel('Status').selectOption('SUCCEEDED');
  await expect(dialog.getByRole('listitem')).toHaveCount(1);
  await expect(dialog.getByRole('listitem')).toContainText('Envelope sent');
  await dialog.getByLabel('Status').selectOption('');

  await dialog.getByLabel('Event', { exact: true }).selectOption('envelope.voided');
  await expect(dialog.getByRole('listitem')).toHaveCount(1);
  await expect(dialog.getByRole('listitem')).toContainText('Envelope cancelled');
  await dialog.getByLabel('Event', { exact: true }).selectOption('');
  await expect(dialog.getByRole('listitem')).toHaveCount(2);

  const sentRow = dialog.getByRole('listitem').filter({ hasText: 'Envelope sent' });
  await sentRow.getByRole('button', { name: `Event id ${eventId}` }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(eventId);
  await sentRow.getByRole('button', { name: `Envelope id ${envelopeId}` }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(envelopeId);

  await dialog.getByRole('button', { name: 'Close' }).click();
});

test('each API key has its own embedded-editor origins (docs/18 workstream 7)', async ({
  page,
}) => {
  await signUp(page, 'integrations-origins');
  await page.goto('/settings/integrations');

  // A read-only key never shows an origins field or an Edit origins action.
  await page.getByRole('button', { name: 'Create API key' }).click();
  await page.getByLabel('Key label').fill('Reporting only');
  await page.getByLabel('Read-only key').check();
  await expect(page.getByLabel('Embedded editor origins (optional)')).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Create key' }).click();
  await page.getByRole('button', { name: 'I have saved the key' }).click();
  const readOnlyRow = page.getByRole('listitem').filter({ hasText: 'Reporting only' });
  await expect(readOnlyRow.getByRole('button', { name: 'Edit origins' })).toHaveCount(0);

  // A full key can set an invalid line, see which line is wrong, fix it and
  // create with one origin.
  await page.getByRole('button', { name: 'Create API key' }).click();
  await page.getByLabel('Key label').fill('HealthProHub integration');
  await page
    .getByLabel('Embedded editor origins (optional)')
    .fill('https://healthprohub.example\nhttps://*.example');
  await page.getByRole('dialog').getByRole('button', { name: 'Create key' }).click();
  await expect(page.getByRole('alert')).toContainText('Line 2');
  await page.getByLabel('Embedded editor origins (optional)').fill('https://healthprohub.example');
  await page.getByRole('dialog').getByRole('button', { name: 'Create key' }).click();
  await page.getByRole('button', { name: 'I have saved the key' }).click();
  const integrationRow = page.getByRole('listitem').filter({ hasText: 'HealthProHub integration' });
  await expect(integrationRow).toContainText('1 origin');

  // A second key's own origins are independent of the first key's.
  await page.getByRole('button', { name: 'Create API key' }).click();
  await page.getByLabel('Key label').fill('Second integration');
  await page.getByRole('dialog').getByRole('button', { name: 'Create key' }).click();
  await page.getByRole('button', { name: 'I have saved the key' }).click();
  const secondRow = page.getByRole('listitem').filter({ hasText: 'Second integration' });
  await expect(secondRow).toContainText('Backend only');

  // Adding an origin to the first key needs no confirmation; removing one does.
  const originsField = page.getByLabel('HealthProHub integration’s embedded editor origins');
  await integrationRow.getByRole('button', { name: 'Edit origins' }).click();
  await originsField.fill('https://healthprohub.example\nhttps://staging.healthprohub.example');
  await page.getByRole('dialog').getByRole('button', { name: 'Save origins' }).click();
  await expect(integrationRow).toContainText('2 origins');

  await integrationRow.getByRole('button', { name: 'Edit origins' }).click();
  await originsField.fill('https://staging.healthprohub.example');
  await page.getByRole('dialog').getByRole('button', { name: 'Save origins' }).click();
  const removalDialog = page.getByRole('dialog', { name: 'Remove access for these origins?' });
  await expect(removalDialog).toContainText('healthprohub.example');
  await removalDialog.getByRole('button', { name: 'Go back' }).click();
  await expect(page.getByRole('dialog', { name: 'Embedded editor origins' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Save origins' }).click();
  await page
    .getByRole('dialog', { name: 'Remove access for these origins?' })
    .getByRole('button', { name: 'Remove and save' })
    .click();
  await expect(integrationRow).toContainText('1 origin');
  await expect(integrationRow).not.toContainText('2 origins');
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
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(
      page
        .getByRole('dialog', { name: 'Workspace navigation' })
        .getByRole('link', { name: 'Settings', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Close navigation' }).click();
  }
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await page.goto('/settings/integrations');
  await expect(page).toHaveURL(/\/dashboard/);
});

test('integration records stay usable with long content on phones and desktops', async ({
  page,
}) => {
  await signUp(page, 'integrations-responsive');
  await page.goto('/settings/integrations');
  const label = 'HealthProHubProductionReportingServiceWithAnUnbrokenName';
  await page.getByRole('button', { name: 'Create API key' }).click();
  await page.getByLabel('Key label').fill(label);
  await page.getByRole('dialog').getByRole('button', { name: 'Create key' }).click();
  await page.getByRole('button', { name: 'I have saved the key' }).click();
  await page.getByRole('button', { name: 'Add webhook' }).click();
  const url = `http://127.0.0.1:9/${'long-endpoint-path'.repeat(8)}`;
  await page.getByLabel('Endpoint URL').fill(url);
  await page.getByLabel('Choose events').check();
  for (const checkbox of await page.getByRole('dialog').getByRole('checkbox').all()) {
    await checkbox.check();
  }
  await page.getByRole('dialog').getByRole('button', { name: 'Add webhook' }).click();
  await page.getByRole('button', { name: 'I have saved the secret' }).click();
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByText(url, { exact: true })).toBeVisible();
    await expect(page.getByText(/Envelope sent, Envelope viewed/)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    for (const name of [
      'Create API key',
      'Add webhook',
      'Revoke',
      'Deliveries',
      'Edit',
      'Deactivate',
    ]) {
      const button = page.getByRole('button', { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
      const bounds = await button.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
    }
  }
});

test('integration dialogs support keyboard navigation and restore focus', async ({ page }) => {
  await signUp(page, 'integrations-keyboard');
  await page.goto('/settings/integrations');
  const create = page.getByRole('button', { name: 'Create API key' });
  await create.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(page.getByLabel('Key label')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Read-only key')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Read-only key')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(create).toBeFocused();
  await page.setViewportSize({ width: 375, height: 667 });
  const add = page.getByRole('button', { name: 'Add webhook' });
  await add.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Endpoint URL')).toBeFocused();
  await page.getByLabel('Choose events').check();
  await page.getByLabel('Envelope sent', { exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Envelope sent', { exact: true })).toBeChecked();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel' }).focus();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(add).toBeFocused();
});

test('integration guide documents all key operations and webhook setup on every screen size', async ({
  page,
  context,
}) => {
  await signUp(page, 'integration-guide');
  await page.goto('/settings/integrations');
  await page.getByRole('tab', { name: 'Integration guide', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'From your application to a signed document' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '2. Upload → prepare → send' })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Upload a PDF' }).click();
  await expect(
    page.getByRole('region', { name: 'Upload a PDF request', exact: true }),
  ).toContainText('--form');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy Upload a PDF request', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('Bearer $ENVELOPE_API_KEY');
  await page.getByRole('tab', { name: 'API reference', exact: true }).click();
  // The 17 envelope operations and the 8 of templates and bulk send (docs/20).
  await expect(page.locator('summary')).toHaveCount(25);
  await page.getByRole('searchbox', { name: 'Search API operations' }).fill('DELETE');
  await expect(page.locator('summary')).toHaveCount(1);
  await page.locator('summary').click();
  await expect(
    page.getByRole('region', { name: 'Remove a recipient request', exact: true }),
  ).toContainText('If-Match');
  await page.getByRole('searchbox', { name: 'Search API operations' }).fill('no such operation');
  await expect(page.getByText(/No matching operations/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByRole('searchbox', { name: 'Search API operations' }).fill('fields');
  await page.locator('summary').filter({ hasText: 'Place signing fields' }).click();
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(
      page.getByRole('button', { name: 'Copy Place signing fields request', exact: true }),
    ).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Webhook guide', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Webhook payload', exact: true })).toContainText(
    'finalVersionNumber',
  );
  await page.getByRole('combobox', { name: 'Webhook event' }).selectOption('recipient.consented');
  await expect(page.getByRole('region', { name: 'Webhook payload', exact: true })).toContainText(
    'consentGivenAt',
  );
  await expect(page.getByText(/envelope.delivered is reserved/)).toBeVisible();
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.getByRole('tab', { name: 'Webhook guide', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Troubleshooting' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Understand an API error' })).toBeVisible();
  await page.getByRole('button', { name: 'Manage connections', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create API key' })).toBeVisible();
});

test('owner tests a webhook, rotates its secret, sees an automatic shutdown and deletes it', async ({
  page,
}) => {
  const requests: { type: string | undefined; signature: string | undefined }[] = [];
  let status = 204;
  receiver = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requests.push({
        type: request.headers['x-envelope-event-type'] as string | undefined,
        signature: request.headers['x-signature'] as string | undefined,
      });
      response.writeHead(status);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) =>
    receiver?.listen(0, '127.0.0.1', resolve).once('error', reject),
  );
  const address = receiver.address();
  if (!address || typeof address === 'string')
    throw new Error('Local webhook receiver did not bind');
  const endpointUrl = `http://127.0.0.1:${address.port}/lifecycle`;

  await signUp(page, 'webhook-lifecycle-owner');
  await page.goto('/settings/integrations');
  await page.getByRole('button', { name: 'Add webhook' }).click();
  await page.getByLabel('Endpoint URL').fill(endpointUrl);
  await page.getByRole('dialog').getByRole('button', { name: 'Add webhook' }).click();
  await page.getByRole('button', { name: 'I have saved the secret' }).click();
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByText(endpointUrl, { exact: true }) });
  await expect(page.getByText('1 of 5 active endpoints')).toBeVisible();

  // A test event: delivered, once, and shown in the deliveries list.
  await row.getByRole('button', { name: 'Send test event' }).click();
  const deliveries = page.getByRole('dialog');
  await expect(deliveries.getByText('Test event', { exact: true })).toBeVisible();
  await expect(
    deliveries.getByRole('listitem').getByText('Delivered', { exact: true }),
  ).toBeVisible({
    timeout: 10_000,
  });
  await expect(deliveries.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  expect(requests.map((item) => item.type)).toEqual(['webhook.test']);
  expect(requests[0]?.signature).toMatch(/^sha256=[a-f0-9]{64}$/);

  // A failing receiver: reported as failed, with no retry offered for a test event.
  status = 500;
  await deliveries.getByRole('button', { name: 'Close' }).click();
  await row.getByRole('button', { name: 'Send test event' }).click();
  await expect(deliveries.getByText('HTTP 500').first()).toBeVisible({ timeout: 10_000 });
  await expect(deliveries.getByRole('listitem').getByText('Failed', { exact: true })).toBeVisible();
  await expect(deliveries.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await deliveries.getByRole('button', { name: 'Close' }).click();
  status = 204;

  // Rotating: the new secret is shown once, and requests then carry two signatures.
  await row.getByRole('button', { name: 'Rotate secret' }).click();
  const rotate = page.getByRole('dialog');
  await expect(rotate.getByLabel('Keep the old secret working for')).toHaveValue('24');
  await rotate.getByRole('button', { name: 'Rotate secret' }).click();
  await expect(page.getByTestId('rotated-webhook-secret')).toContainText(/^whsec_/);
  await expect(
    rotate.getByText(/each request carries a signature for the new secret/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'I have saved the secret' }).click();
  await expect(page.getByTestId('rotated-webhook-secret')).toHaveCount(0);
  await expect(row).toContainText('Also accepted until');
  await row.getByRole('button', { name: 'Send test event' }).click();
  await expect(
    deliveries.getByRole('listitem').getByText('Delivered', { exact: true }).first(),
  ).toBeVisible({
    timeout: 10_000,
  });
  await deliveries.getByRole('button', { name: 'Close' }).click();
  await expect
    .poll(() => requests.at(-1)?.signature?.split(',').length, { timeout: 10_000 })
    .toBe(2);

  // An endpoint the platform turned off says so, and offers reactivate and delete.
  const client = new pg.Client({ connectionString: STACK_ENV.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `UPDATE "WebhookEndpoint"
          SET "isActive" = false, "disabledAt" = now(), "consecutiveFailures" = 3,
              "disabledReason" = 'Turned off automatically: 3 deliveries in a row failed every retry.'
        WHERE url = $1`,
      [endpointUrl],
    );
  } finally {
    await client.end();
  }
  await page.reload();
  await expect(page.getByText('0 of 5 active endpoints')).toBeVisible();
  await expect(row.getByText('Turned off automatically', { exact: true })).toBeVisible();
  await expect(row).toContainText('3 deliveries in a row failed every retry');
  await row.getByRole('button', { name: 'Reactivate' }).click();
  await expect(row.getByText('Turned off automatically', { exact: true })).toHaveCount(0);
  await expect(page.getByText('1 of 5 active endpoints')).toBeVisible();

  // Deleting needs the endpoint to be inactive first, and a confirmation.
  await expect(row.getByRole('button', { name: 'Delete permanently' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Deactivate' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Deactivate webhook' }).click();
  await row.getByRole('button', { name: 'Delete permanently' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete webhook' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No webhooks' })).toBeVisible();
});
