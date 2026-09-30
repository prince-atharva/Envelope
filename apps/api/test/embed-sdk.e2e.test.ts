import { readFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';

const dist = path.resolve(__dirname, '../../../packages/embed/dist');

describe('hosted embed SDK (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('serves the plain-script build without any credential, cross-origin readable', async () => {
    const response = await request(t.http).get('/api/v1/embed/sdk/v1/envelope.js').expect(200);
    expect(response.headers['content-type']).toMatch(/^application\/javascript/);
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers.etag).toMatch(/^"sha256-[A-Za-z0-9_-]+"$/);
    expect(response.text).toBe(await readFile(path.join(dist, 'envelope.js'), 'utf8'));
    expect(response.text).toContain('EnvelopeEmbed');
  });

  it('serves the ES module build as JavaScript', async () => {
    const response = await request(t.http).get('/api/v1/embed/sdk/v1/envelope.mjs').expect(200);
    expect(response.headers['content-type']).toMatch(/^text\/javascript/);
    expect(response.text).toContain('createEnvelopeEditor');
  });

  it('is self-contained: no runtime import of another package', async () => {
    for (const file of ['envelope.js', 'envelope.mjs']) {
      const { text } = await request(t.http).get(`/api/v1/embed/sdk/v1/${file}`).expect(200);
      expect(text).not.toMatch(/@envelope\/shared|from\s*["'][^./]|require\(|zod/);
    }
  });

  it('answers a repeat request with 304 when the ETag matches', async () => {
    const first = await request(t.http).get('/api/v1/embed/sdk/v1/envelope.mjs').expect(200);
    const again = await request(t.http)
      .get('/api/v1/embed/sdk/v1/envelope.mjs')
      .set('If-None-Match', first.headers.etag as string)
      .expect(304);
    expect(again.text).toBe('');
    expect(again.headers.etag).toBe(first.headers.etag);
    await request(t.http)
      .get('/api/v1/embed/sdk/v1/envelope.mjs')
      .set('If-None-Match', '"something-else"')
      .expect(200);
  });

  it('refuses names other than the two builds, including traversal', async () => {
    for (const name of ['envelope.js.map', 'index.d.ts', 'package.json', '..%2Fpackage.json']) {
      await request(t.http).get(`/api/v1/embed/sdk/v1/${name}`).expect(404);
    }
    await request(t.http).get('/api/v1/embed/sdk/v2/envelope.js').expect(404);
    await request(t.http).get('/api/v1/embed/sdk/v1/constructor').expect(404);
  });
});
