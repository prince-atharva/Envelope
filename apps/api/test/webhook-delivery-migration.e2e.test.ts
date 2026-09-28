import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { expect, it } from 'vitest';
import { assertTestDatabase, TEST_ENV } from './test-env';

it('backfills delivery envelope IDs and adds browsing indexes without changing stored payloads', async () => {
  const url = TEST_ENV.DIRECT_DATABASE_URL ?? '';
  assertTestDatabase(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    // A temporary table shadows the real table; rollback removes the fixture
    // and migration DDL without touching the application's delivery history.
    await client.query(`CREATE TEMP TABLE "WebhookDelivery" (
      id uuid PRIMARY KEY, "tenantId" uuid, "webhookEndpointId" uuid, payload jsonb
    )`);
    const envelopeId = randomUUID();
    const payloads = [
      { data: { envelopeId, recipientEmail: 'signer@example.test' } },
      { data: {} },
      { data: { envelopeId: null } },
      { data: { envelopeId: 'browser-fixture' } },
    ];
    for (const payload of payloads) {
      await client.query(
        'INSERT INTO "WebhookDelivery" (id, "tenantId", "webhookEndpointId", payload) VALUES ($1, $2, $3, $4)',
        [randomUUID(), randomUUID(), randomUUID(), JSON.stringify(payload)],
      );
    }
    const migration = readFileSync(
      path.join(
        __dirname,
        '../prisma/migrations/20260928083210_webhook_delivery_envelope/migration.sql',
      ),
      'utf8',
    );
    await client.query(migration);
    const result = await client.query<{ envelopeId: string | null; payload: unknown }>(
      'SELECT "envelopeId", payload FROM "WebhookDelivery"',
    );
    expect(result.rows).toEqual(
      expect.arrayContaining([
        { envelopeId, payload: payloads[0] },
        { envelopeId: null, payload: payloads[1] },
        { envelopeId: null, payload: payloads[2] },
        { envelopeId: null, payload: payloads[3] },
      ]),
    );
    const indexes = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = (
         SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()
       ) AND tablename = 'WebhookDelivery'`,
    );
    const definitions = indexes.rows.map((row) => row.indexdef).join('\n');
    expect(definitions).toContain('("tenantId", "envelopeId")');
    expect(definitions).toContain('("tenantId", id)');
    expect(definitions).toContain('("webhookEndpointId", id)');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
