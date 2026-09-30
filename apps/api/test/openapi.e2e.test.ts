import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  API_BASE_PATH,
  INTEGRATION_OPERATIONS,
  OPERATION_RESPONSES,
  problemDetailsSchema,
} from '@envelope/shared';
import type { Response } from 'supertest';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../src/bootstrap/openapi';
import { makePdf } from './fixtures/pdfs';
import { createTestApp, createTestWorker, type TestApp, type TestWorker } from './helpers/app';
import { registerUser, type SignedInUser, uniqueEmail } from './helpers/auth';
import { truncateAll } from './helpers/db';
import { bearer, linkFor, prepareEnvelope } from './helpers/signing';

const SNAPSHOT = path.resolve(__dirname, '../../../docs/developers/openapi.json');
const parentOrigin = 'https://partner.example';

describe('OpenAPI document and response contract (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let key: string;
  let readOnlyKey: string;

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    owner = await registerUser(t.http, { organization: 'Contract Clinic' });
    const created = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(owner))
      .send({ label: 'Contract', embedOrigins: [parentOrigin] })
      .expect(201);
    key = created.body.rawKey;
    const readOnly = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(owner))
      .send({ label: 'Reader', readOnly: true })
      .expect(201);
    readOnlyKey = readOnly.body.rawKey;
  });
  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  const call = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, apiKey = key) =>
    request(t.http)[method](`/api/v1${url}`).set('Authorization', `Bearer ${apiKey}`);

  /** Status and body of a real response must be what the contract promises. */
  function expectContract(id: string, response: Response) {
    const contract = OPERATION_RESPONSES[id];
    if (!contract) throw new Error(`no contract for ${id}`);
    expect(response.status, `${id}: ${response.text.slice(0, 200)}`).toBe(contract.status);
    if (contract.kind === 'json') {
      const parsed = contract.schema.safeParse(response.body);
      expect(parsed.success, `${id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  }

  describe('the served document', () => {
    it('matches the committed snapshot (regenerate with UPDATE_OPENAPI=1)', () => {
      const document = buildOpenApiDocument(t.app);
      const text = `${JSON.stringify(document, null, 2)}\n`;
      if (process.env.UPDATE_OPENAPI === '1' || !existsSync(SNAPSHOT)) {
        writeFileSync(SNAPSHOT, text);
        return;
      }
      const committed = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as { info: { version: string } };
      const current = JSON.parse(text) as { info: { version: string } };
      current.info.version = committed.info.version;
      expect(current).toEqual(committed);
    });

    it('declares the three security schemes and documents every catalog operation', () => {
      const document = buildOpenApiDocument(t.app) as unknown as {
        components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
        paths: Record<string, Record<string, Record<string, unknown>>>;
      };
      expect(Object.keys(document.components.securitySchemes)).toEqual(
        expect.arrayContaining(['apiKey', 'session', 'embedSession']),
      );
      for (const operation of INTEGRATION_OPERATIONS) {
        const openapi =
          document.paths[`${API_BASE_PATH}${operation.path.replace(/:(\w+)/g, '{$1}')}`]?.[
            operation.method.toLowerCase()
          ];
        expect(openapi, operation.id).toBeDefined();
        expect(openapi?.security, operation.id).toBeDefined();
        expect(Object.keys(openapi?.responses as object), operation.id).toContain(
          String(OPERATION_RESPONSES[operation.id]?.status),
        );
      }
      expect(document.components.schemas).toHaveProperty('EnvelopeDetail');
      expect(document.components.schemas).toHaveProperty('WebhookEventEnvelopeCompleted');
    });

    it('has no dangling references', () => {
      const text = JSON.stringify(buildOpenApiDocument(t.app));
      const document = JSON.parse(text) as { components: { schemas: Record<string, unknown> } };
      for (const [, name] of text.matchAll(/#\/components\/schemas\/([A-Za-z0-9_]+)/g))
        expect(document.components.schemas, `${name}`).toHaveProperty(name as string);
      expect(text).not.toContain('"$id"');
    });

    it('is not served when API_DOCS_ENABLED is false, as in production', async () => {
      await request(t.http).get('/api/docs/openapi.json').expect(404);
    });
  });

  describe('real responses match the documented schemas', () => {
    it('follows a document from upload to cancel with an API key', async () => {
      const pdf = await makePdf(1);
      const uploaded = await call('post', '/envelopes')
        .attach('file', pdf, { filename: 'agreement.pdf', contentType: 'application/pdf' })
        .field('externalId', 'visit:1001')
        .field('metadata', JSON.stringify({ department: 'billing' }));
      expectContract('upload', uploaded);
      const id = uploaded.body.id as string;

      expectContract('list', await call('get', '/envelopes?view=drafts'));
      expectContract('counts', await call('get', '/envelopes/counts'));
      expectContract('detail', await call('get', `/envelopes/${id}`));
      expectContract('events', await call('get', `/envelopes/${id}/events`));
      expectContract(
        'update',
        await call('patch', `/envelopes/${id}`).send({ sequentialSigning: true }),
      );

      const first = await call('post', `/envelopes/${id}/recipients`).send({
        name: 'Alex Morgan',
        email: uniqueEmail('alex'),
        role: 'SIGNER',
        routingOrder: 1,
      });
      expectContract('recipient-add', first);
      const second = await call('post', `/envelopes/${id}/recipients`).send({
        name: 'Sam Lee',
        email: uniqueEmail('sam'),
        role: 'SIGNER',
        routingOrder: 2,
      });
      expectContract('recipient-add', second);
      expectContract(
        'recipient-update',
        await call('patch', `/envelopes/${id}/recipients/${second.body.recipient.id}`).send({
          name: 'Sam Leigh',
        }),
      );
      const extra = await call('post', `/envelopes/${id}/recipients`).send({
        name: 'Temp',
        email: uniqueEmail('temp'),
        role: 'CC',
      });
      expectContract(
        'recipient-delete',
        await call('delete', `/envelopes/${id}/recipients/${extra.body.recipient.id}`),
      );
      expectContract(
        'fields',
        await call('put', `/envelopes/${id}/fields`).send({
          fields: [first.body.recipient.id, second.body.recipient.id].map((recipientId, index) => ({
            id: randomUUID(),
            recipientId,
            type: 'SIGNATURE',
            pageNumber: 1,
            ratioX: 0.1 + index * 0.4,
            ratioY: 0.7,
            ratioWidth: 0.3,
            ratioHeight: 0.08,
            required: true,
          })),
        }),
      );

      const file = await call('get', `/envelopes/${id}/file?version=0`).buffer(true);
      expect(file.status).toBe(OPERATION_RESPONSES.file?.status);
      expect(file.headers['content-type']).toMatch(/application\/pdf/);
      expect(file.headers.etag).toBeDefined();
      const original = await call('get', `/envelopes/${id}/documents/original`).buffer(true);
      expect(original.status).toBe(OPERATION_RESPONSES['document-original']?.status);

      expectContract(
        'send',
        await call('post', `/envelopes/${id}/send`)
          .set('Idempotency-Key', randomUUID())
          .send({ expiresInDays: 14 }),
      );
      // The mail worker records EMAIL_SENT after send returns; wait before the next audit write (AGENTS.md §6).
      await linkFor(worker.mailbox, first.body.recipient.email);

      expectContract(
        'remind',
        await call('post', `/envelopes/${id}/remind`).send({
          recipientIds: [second.body.recipient.id],
        }),
      );
      expectContract(
        'void',
        await call('post', `/envelopes/${id}/void`).send({ reason: 'Sent to the wrong patient' }),
      );
    });

    it('saves, reads and archives a template', async () => {
      const envelope = await prepareEnvelope(t.http, owner, [
        { name: 'Alex Morgan', email: uniqueEmail('alex') },
      ]);
      const created = await call('post', '/templates').send({
        envelopeId: envelope.id,
        name: 'Contract template',
      });
      expectContract('template-create', created);
      expectContract('template-list', await call('get', '/templates', readOnlyKey));
      expectContract(
        'template-envelope',
        await call('post', `/templates/${created.body.id}/envelopes`).send({
          recipients: [{ role: 'Alex Morgan', name: 'Alex Morgan', email: uniqueEmail('alex') }],
        }),
      );
      expectContract(
        'template-get',
        await call('get', `/templates/${created.body.id}`, readOnlyKey),
      );
      const batch = await call('post', `/templates/${created.body.id}/bulk`).send({
        rows: [
          {
            recipients: [{ role: 'Alex Morgan', name: 'Sam Lee', email: uniqueEmail('sam') }],
          },
        ],
      });
      expectContract('bulk-create', batch);
      expectContract('bulk-list', await call('get', '/bulk-batches', readOnlyKey));
      expectContract(
        'bulk-get',
        await call('get', `/bulk-batches/${batch.body.batchId}`, readOnlyKey),
      );
      expectContract(
        'template-update',
        await call('patch', `/templates/${created.body.id}`).send({ archived: true }),
      );
    });

    it('issues and revokes an embedded editor session', async () => {
      const draft = await call('post', '/envelopes').attach('file', await makePdf(1), {
        filename: 'agreement.pdf',
        contentType: 'application/pdf',
      });
      const issued = await call('post', '/embed/sessions').send({
        mode: 'existing',
        envelopeId: draft.body.id,
        parentOrigin,
        externalActorId: 'staff:1',
        actions: ['edit', 'send'],
      });
      expectContract('embed-session-issue', issued);
      expectContract(
        'embed-session-revoke',
        await call('delete', `/embed/sessions/${issued.body.sessionId}`),
      );
    });

    it('returns problem+json that matches the documented shape', async () => {
      const missing = await call('get', `/envelopes/${randomUUID()}`);
      expect(missing.status).toBe(404);
      expect(missing.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(problemDetailsSchema.parse(missing.body).code).toBe('NOT_FOUND');

      const readOnly = await call('post', '/envelopes', readOnlyKey);
      expect(problemDetailsSchema.parse(readOnly.body).code).toBe('API_KEY_READ_ONLY');

      const invalid = await request(t.http)
        .get('/api/v1/envelopes')
        .set('Authorization', 'Bearer eak_not-a-key');
      expect(problemDetailsSchema.parse(invalid.body).code).toBe('API_KEY_INVALID');

      const notAllowed = await call('get', '/api-keys');
      expect(problemDetailsSchema.parse(notAllowed.body).code).toBe('API_KEY_NOT_ALLOWED');
    });
  });
});
