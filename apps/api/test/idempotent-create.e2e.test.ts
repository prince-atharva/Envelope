import type {
  CreateApiKeyResponse,
  CreateEmbedSessionResponse,
  EnvelopeDetail,
} from '@envelope/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisService } from '../src/redis/redis.service';
import { makePdf } from './fixtures/pdfs';
import { createTestApp, type TestApp } from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { ownerQuery, truncateAll } from './helpers/db';
import { bearer } from './helpers/signing';

const origin = 'https://healthprohub.example';

/**
 * Optional Idempotency-Key on envelope and embedded-session creation
 * (docs/18 workstream 10, ADR 0019). Unlike send and extend, no key means
 * no protection and no error.
 */
describe('optional idempotency on create (e2e)', () => {
  let t: TestApp;
  let owner: SignedInUser;
  let key: string;
  let n = 0;
  const idem = () => `create-key-${Date.now()}-${n++}`;

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    owner = await registerUser(t.http);
    const created = await request(t.http)
      .post('/api/v1/api-keys')
      .set('Authorization', bearer(owner))
      .send({ label: 'Partner', embedOrigins: [origin] })
      .expect(201);
    key = (created.body as CreateApiKeyResponse).rawKey;
  });

  afterAll(async () => {
    await t.close();
  });

  const keyAuth = () => `Bearer ${key}`;
  // makePdf stamps the current second into the file; the request fingerprint
  // includes the PDF's hash, so a retry must send the very same bytes.
  const pdfs = new Map<number, Buffer>();
  const pdfOf = async (pages: number) => {
    const cached = pdfs.get(pages) ?? (await makePdf(pages));
    pdfs.set(pages, cached);
    return cached;
  };
  const titled = async (title: string, idempotencyKey?: string, pages = 1) => {
    let req = request(t.http)
      .post('/api/v1/envelopes')
      .set('Authorization', keyAuth())
      .field('title', title)
      .attach('file', await pdfOf(pages), { filename: 'a.pdf', contentType: 'application/pdf' });
    if (idempotencyKey) req = req.set('Idempotency-Key', idempotencyKey);
    return req;
  };
  const countTitled = async (title: string) =>
    Number(
      (
        await ownerQuery<{ count: string }>(
          `SELECT count(*)::text FROM "Envelope" WHERE title=$1`,
          [title],
        )
      ).rows[0]?.count,
    );

  describe('POST /envelopes', () => {
    it('returns the same envelope for a retry with the same key and body', async () => {
      const k = idem();
      const first = await titled('Retry me', k);
      expect(first.status).toBe(201);
      expect(first.headers['idempotency-replayed']).toBeUndefined();
      const second = await titled('Retry me', k);
      expect(second.status).toBe(201);
      expect(second.headers['idempotency-replayed']).toBe('true');
      expect((second.body as EnvelopeDetail).id).toBe((first.body as EnvelopeDetail).id);
      expect(await countTitled('Retry me')).toBe(1);
    });

    it('refuses the same key with a different body or a different file', async () => {
      const k = idem();
      await titled('Original', k).then((r) => expect(r.status).toBe(201));
      const otherTitle = await titled('Changed', k);
      expect(otherTitle.status).toBe(422);
      expect(otherTitle.body.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
      const otherFile = await titled('Original', k, 2);
      expect(otherFile.status).toBe(422);
      expect(await countTitled('Changed')).toBe(0);
    });

    it('still creates two drafts when no key is sent (unchanged, documented)', async () => {
      await titled('No key').then((r) => expect(r.status).toBe(201));
      await titled('No key').then((r) => expect(r.status).toBe(201));
      expect(await countTitled('No key')).toBe(2);
    });

    it('refuses a malformed key instead of silently ignoring it', async () => {
      const res = await titled('Bad key', 'short');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      expect(await countTitled('Bad key')).toBe(0);
    });

    it('does not release a key for another tenant', async () => {
      const k = idem();
      const mine = await titled('Tenant scoped', k);
      const outsider = await registerUser(t.http);
      const theirs = await request(t.http)
        .post('/api/v1/envelopes')
        .set('Authorization', bearer(outsider))
        .set('Idempotency-Key', k)
        .field('title', 'Tenant scoped')
        .attach('file', await makePdf(1), { filename: 'a.pdf', contentType: 'application/pdf' });
      expect(theirs.status).toBe(201);
      expect(theirs.headers['idempotency-replayed']).toBeUndefined();
      expect((theirs.body as EnvelopeDetail).id).not.toBe((mine.body as EnvelopeDetail).id);
    });

    it('lets a failed first request be retried as it was', async () => {
      const k = idem();
      const bad = await request(t.http)
        .post('/api/v1/envelopes')
        .set('Authorization', keyAuth())
        .set('Idempotency-Key', k)
        .field('title', 'Not a pdf')
        .attach('file', Buffer.from('plain text'), { filename: 'a.pdf' });
      expect(bad.status).toBeGreaterThanOrEqual(400);
      const good = await request(t.http)
        .post('/api/v1/envelopes')
        .set('Authorization', keyAuth())
        .set('Idempotency-Key', k)
        .field('title', 'Not a pdf')
        .attach('file', await makePdf(1), { filename: 'a.pdf', contentType: 'application/pdf' });
      // A different file is a different request, but only a *finished* key is
      // remembered: the failed attempt released it.
      expect(good.status).toBe(201);
    });
  });

  describe('POST /embed/sessions', () => {
    const uploadBody = (actor = 'staff:1') => ({
      mode: 'upload',
      parentOrigin: origin,
      externalActorId: actor,
      actions: ['edit'],
    });
    const issue = (body: object, idempotencyKey?: string) => {
      let req = request(t.http)
        .post('/api/v1/embed/sessions')
        .set('Authorization', keyAuth())
        .send(body);
      if (idempotencyKey) req = req.set('Idempotency-Key', idempotencyKey);
      return req;
    };
    const exchange = (s: CreateEmbedSessionResponse) =>
      request(t.http)
        .post('/api/v1/embed/sessions/exchange')
        .send({ sessionId: s.sessionId, launchToken: s.launchToken });

    it('replays as the same session with a fresh launch token; the old one stops working', async () => {
      const k = idem();
      const first = await issue(uploadBody(), k).expect(201);
      const second = await issue(uploadBody(), k).expect(201);
      expect(second.headers['idempotency-replayed']).toBe('true');
      const a = first.body as CreateEmbedSessionResponse;
      const b = second.body as CreateEmbedSessionResponse;
      expect(b.sessionId).toBe(a.sessionId);
      expect(b.launchToken).not.toBe(a.launchToken);
      expect(b.frameUrl).toBe(a.frameUrl);

      const old = await exchange(a);
      expect(old.status).toBe(401);
      expect(old.body.code).toBe('EMBED_SESSION_INVALID');
      await exchange(b).expect(200);
    });

    it('never keeps a launch token in Redis', async () => {
      const k = idem();
      const issued = (await issue(uploadBody(), k).expect(201)).body as CreateEmbedSessionResponse;
      const redis = t.app.get(RedisService).client;
      const keys = await redis.keys('*idempotency*');
      expect(keys.length).toBeGreaterThan(0);
      for (const redisKey of keys) {
        expect(await redis.get(redisKey)).not.toContain(issued.launchToken);
      }
    });

    it('cannot replay a session that was already opened, and refuses a changed body', async () => {
      const k = idem();
      const issued = (await issue(uploadBody(), k).expect(201)).body as CreateEmbedSessionResponse;
      await exchange(issued).expect(200);
      const replay = await issue(uploadBody(), k);
      expect(replay.status).toBe(409);
      expect(replay.body.code).toBe('EMBED_LAUNCH_USED');

      const k2 = idem();
      await issue(uploadBody(), k2).expect(201);
      const changed = await issue(uploadBody('staff:2'), k2);
      expect(changed.status).toBe(422);
      expect(changed.body.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
    });

    it('creates a new session per request without a key, or with a different key', async () => {
      const a = (await issue(uploadBody()).expect(201)).body as CreateEmbedSessionResponse;
      const b = (await issue(uploadBody()).expect(201)).body as CreateEmbedSessionResponse;
      expect(a.sessionId).not.toBe(b.sessionId);
      const c = (await issue(uploadBody(), idem()).expect(201)).body as CreateEmbedSessionResponse;
      const d = (await issue(uploadBody(), idem()).expect(201)).body as CreateEmbedSessionResponse;
      expect(c.sessionId).not.toBe(d.sessionId);
    });

    it('refuses to reissue a revoked session', async () => {
      const k = idem();
      const issued = (await issue(uploadBody(), k).expect(201)).body as CreateEmbedSessionResponse;
      await request(t.http)
        .delete(`/api/v1/embed/sessions/${issued.sessionId}`)
        .set('Authorization', keyAuth())
        .expect(204);
      const replay = await issue(uploadBody(), k);
      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe('EMBED_SESSION_INVALID');
    });
  });
});
