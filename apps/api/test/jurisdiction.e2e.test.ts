import { createHash, randomUUID } from 'node:crypto';
import type { EnvelopeDetail } from '@envelope/shared';
import { JURISDICTION_POLICIES, JURISDICTION_POLICY_VERSION } from '@envelope/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePdf } from './fixtures/pdfs';
import { createTestApp, createTestWorker, type TestApp, type TestWorker } from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { truncateAll } from './helpers/db';
import { bearer, linkFor, sendEnvelope } from './helpers/signing';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Jurisdiction policy frozen at creation, and blocked document categories
 * (docs/07, ADR 0011, docs/17 steps 3-4).
 */
describe('jurisdiction policy and blocked categories (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let pdf: Buffer;

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Policy Owner', organization: 'Policy Clinic' });
    pdf = await makePdf(1);
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  function create(fields: Record<string, string> = {}) {
    let req = request(t.http)
      .post('/api/v1/envelopes')
      .set('Authorization', bearer(owner))
      .attach('file', pdf, { filename: 'agreement.pdf', contentType: 'application/pdf' });
    for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
    return req;
  }

  it('rejects a blocked category, naming both the category and the jurisdiction', async () => {
    const res = await create({ documentCategory: 'WILL_OR_TESTAMENTARY' }).expect(422);
    expect(res.body.code).toBe('DOCUMENT_CATEGORY_BLOCKED');
    expect(res.body.detail).toContain('US');
    expect(res.body.detail.toLowerCase()).toContain('will');
  });

  it('allows an ordinary category, and freezes the tenant default US policy onto it', async () => {
    const res = await create({ documentCategory: 'COMMERCIAL_CONTRACT' }).expect(201);
    const envelope = res.body as EnvelopeDetail;
    expect(envelope.documentCategory).toBe('COMMERCIAL_CONTRACT');
    expect(envelope.jurisdictionCode).toBe('US');
    expect(envelope.policyVersion).toBe(JURISDICTION_POLICY_VERSION);
  });

  it('defaults an unspecified category to OTHER, which is never blocked', async () => {
    const res = await create().expect(201);
    expect((res.body as EnvelopeDetail).documentCategory).toBe('OTHER');
  });

  it('resolves a per-envelope jurisdiction override, distinct from the tenant default', async () => {
    const res = await create({
      documentCategory: 'COMMERCIAL_CONTRACT',
      jurisdictionCode: 'EU',
    }).expect(201);
    expect((res.body as EnvelopeDetail).jurisdictionCode).toBe('EU');
  });

  it('a category can be blocked in one jurisdiction and not another', async () => {
    // US blocks utility/eviction/insurance notices; EU does not (docs/17 step 1).
    await create({ documentCategory: 'UTILITY_EVICTION_INSURANCE_NOTICE' }).expect(422);
    await create({
      documentCategory: 'UTILITY_EVICTION_INSURANCE_NOTICE',
      jurisdictionCode: 'EU',
    }).expect(201);
  });

  it(
    "the signer's consent notice comes from the envelope's frozen snapshot, so an EU envelope " +
      'shows EU wording and a US envelope shows US wording, even side by side (ADR 0011)',
    async () => {
      const euEnvelope = (
        await create({ documentCategory: 'COMMERCIAL_CONTRACT', jurisdictionCode: 'EU' }).expect(
          201,
        )
      ).body as EnvelopeDetail;
      const usEnvelope = (await create({ documentCategory: 'COMMERCIAL_CONTRACT' }).expect(201))
        .body as EnvelopeDetail;

      for (const envelope of [euEnvelope, usEnvelope]) {
        const added = await request(t.http)
          .post(`/api/v1/envelopes/${envelope.id}/recipients`)
          .set('Authorization', bearer(owner))
          .send({
            name: 'Consent Signer',
            email: `consent.signer.${envelope.id}@example.com`,
            role: 'SIGNER',
          })
          .expect(201);
        const recipientId = added.body.recipient.id as string;
        await request(t.http)
          .put(`/api/v1/envelopes/${envelope.id}/fields`)
          .set('Authorization', bearer(owner))
          .send({
            fields: [
              {
                id: randomUUID(),
                recipientId,
                type: 'SIGNATURE',
                pageNumber: 1,
                required: true,
                ratioX: 0.1,
                ratioY: 0.1,
                ratioWidth: 0.25,
                ratioHeight: 0.05,
              },
            ],
          })
          .expect(200);
        await sendEnvelope(t.http, owner, envelope.id).expect(200);
      }

      const euToken = await linkFor(worker.mailbox, `consent.signer.${euEnvelope.id}@example.com`);
      const usToken = await linkFor(worker.mailbox, `consent.signer.${usEnvelope.id}@example.com`);
      const euSession = await request(t.http).get(`/api/v1/sign/${euToken}`).expect(200);
      const usSession = await request(t.http).get(`/api/v1/sign/${usToken}`).expect(200);

      expect(euSession.body.consentText).toBe(JURISDICTION_POLICIES.EU?.consentDisclosureText);
      expect(usSession.body.consentText).toBe(JURISDICTION_POLICIES.US?.consentDisclosureText);
      expect(euSession.body.consentText).not.toBe(usSession.body.consentText);
      expect(euSession.body.consentTextHash).toBe(sha256(euSession.body.consentText));
    },
  );
});
