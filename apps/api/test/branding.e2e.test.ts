import type { BrandingSettings } from '@envelope/shared';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createTestWorker, type TestApp, type TestWorker } from './helpers/app';
import { registerUser, type SignedInUser } from './helpers/auth';
import { truncateAll } from './helpers/db';
import { bearer } from './helpers/signing';
import { createApiKey, inviteUser } from './helpers/workspace';

async function logoPng(width = 600, height = 300): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 29, g: 78, b: 216, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

/** Workspace branding (docs/22 step 6, ADR 0034): who may set it, what is stored and what is served. */
describe('workspace branding (e2e)', () => {
  let t: TestApp;
  let worker: TestWorker;
  let owner: SignedInUser;
  let other: SignedInUser;

  beforeAll(async () => {
    await truncateAll();
    t = await createTestApp();
    worker = await createTestWorker();
    owner = await registerUser(t.http, { fullName: 'Brand Owner', organization: 'Brand Clinic' });
    other = await registerUser(t.http, { fullName: 'Other Owner', organization: 'Other Clinic' });
  });

  afterAll(async () => {
    await worker.close();
    await t.close();
  });

  const get = (user: SignedInUser) =>
    request(t.http).get('/api/v1/branding').set('Authorization', bearer(user));

  it('starts with no colour and no logo', async () => {
    const res = await get(owner).expect(200);
    expect(res.body).toEqual({ workspaceName: 'Brand Clinic', color: null, logoUrl: null });
  });

  it('sets and clears the accent colour, lower-casing it', async () => {
    const set = await request(t.http)
      .patch('/api/v1/branding')
      .set('Authorization', bearer(owner))
      .send({ color: '#1D4ED8' })
      .expect(200);
    expect((set.body as BrandingSettings).color).toBe('#1d4ed8');
    const cleared = await request(t.http)
      .patch('/api/v1/branding')
      .set('Authorization', bearer(owner))
      .send({ color: null })
      .expect(200);
    expect((cleared.body as BrandingSettings).color).toBeNull();
  });

  it('refuses a colour white text cannot be read on, and a malformed one', async () => {
    for (const color of ['#ffeb3b', 'blue', '#123']) {
      await request(t.http)
        .patch('/api/v1/branding')
        .set('Authorization', bearer(owner))
        .send({ color })
        .expect(400);
    }
  });

  it('stores a re-encoded PNG and serves it publicly with safe headers', async () => {
    const put = await request(t.http)
      .put('/api/v1/branding/logo')
      .set('Authorization', bearer(owner))
      .attach('file', await logoPng(), { filename: 'logo.png', contentType: 'image/png' })
      .expect(200);
    const { logoUrl } = put.body as BrandingSettings;
    expect(logoUrl).toMatch(/^\/api\/v1\/branding\/logo\/[A-Za-z0-9_-]{20,}$/);
    expect(logoUrl).not.toContain(owner.body.user.tenant.id);

    // No credentials: an email client fetches it like this.
    const served = await request(t.http)
      .get(logoUrl as string)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
    const meta = await sharp(served.body as Buffer).metadata();
    expect(meta.width).toBeLessThanOrEqual(480);
    expect(meta.height).toBeLessThanOrEqual(160);
  });

  it('gives a replaced logo a new address and stops serving the old one', async () => {
    const first = (await get(owner).expect(200)).body as BrandingSettings;
    const put = await request(t.http)
      .put('/api/v1/branding/logo')
      .set('Authorization', bearer(owner))
      .attach('file', await logoPng(300, 100), { filename: 'b.png', contentType: 'image/png' })
      .expect(200);
    const second = put.body as BrandingSettings;
    expect(second.logoUrl).not.toBe(first.logoUrl);
    await request(t.http)
      .get(first.logoUrl as string)
      .expect(404);
    await request(t.http)
      .get(second.logoUrl as string)
      .expect(200);
  });

  it('refuses SVG, a wrong file, an oversize file and a missing file', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    for (const body of [svg, Buffer.from('plain text'), Buffer.alloc(600 * 1024, 1)]) {
      const res = await request(t.http)
        .put('/api/v1/branding/logo')
        .set('Authorization', bearer(owner))
        .attach('file', body, { filename: 'logo.png', contentType: 'image/png' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_BRAND_LOGO');
    }
    const none = await request(t.http)
      .put('/api/v1/branding/logo')
      .set('Authorization', bearer(owner))
      .field('x', 'y');
    expect([400, 422]).toContain(none.status);
  });

  it('removes the logo', async () => {
    const before = (await get(owner).expect(200)).body as BrandingSettings;
    const res = await request(t.http)
      .delete('/api/v1/branding/logo')
      .set('Authorization', bearer(owner))
      .expect(200);
    expect((res.body as BrandingSettings).logoUrl).toBeNull();
    await request(t.http)
      .get(before.logoUrl as string)
      .expect(404);
  });

  it('is Admin and Owner only, and closed to API keys', async () => {
    const admin = await inviteUser(t.http, worker, owner, 'ADMIN');
    const member = await inviteUser(t.http, worker, owner, 'MEMBER');
    await get(admin).expect(200);
    await get(member).expect(403);
    await request(t.http)
      .patch('/api/v1/branding')
      .set('Authorization', bearer(member))
      .send({ color: '#1d4ed8' })
      .expect(403);
    await request(t.http)
      .put('/api/v1/branding/logo')
      .set('Authorization', bearer(member))
      .attach('file', await logoPng(), { filename: 'l.png', contentType: 'image/png' })
      .expect(403);
    const key = await createApiKey(t.http, owner);
    await request(t.http)
      .get('/api/v1/branding')
      .set('Authorization', key.authorization)
      .expect(403);
    await request(t.http).get('/api/v1/branding').expect(401);
  });

  it("never lets one workspace change or read another's branding", async () => {
    await request(t.http)
      .patch('/api/v1/branding')
      .set('Authorization', bearer(owner))
      .send({ color: '#1d4ed8' })
      .expect(200);
    const mine = (await get(other).expect(200)).body as BrandingSettings;
    expect(mine).toEqual({ workspaceName: 'Other Clinic', color: null, logoUrl: null });
  });

  it('answers 404 for a download link that is malformed or unknown, so the page keeps the product look', async () => {
    await request(t.http).get('/api/v1/download/not-a-token/brand').expect(404);
    await request(t.http)
      .get(`/api/v1/download/${'0'.repeat(64)}/brand`)
      .expect(404);
  });

  it('answers 404 for an unknown logo reference', async () => {
    await request(t.http).get('/api/v1/branding/logo/not-a-real-reference').expect(404);
  });
});
