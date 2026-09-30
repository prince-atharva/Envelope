import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageService, templateDocumentKey } from '../src/storage/storage.service';
import { createTestApp, type TestApp } from './helpers/app';

async function bytesOf(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/** Templates keep their own copy of a PDF, and so does every envelope made from one (ADR 0027). */
describe('storage copy (e2e)', () => {
  let t: TestApp;
  let storage: StorageService;
  const source = `tests/storage-copy/${randomUUID()}.pdf`;
  const target = templateDocumentKey(randomUUID(), randomUUID(), randomUUID());
  const body = Buffer.from('%PDF-1.7 copy test document\n');

  beforeAll(async () => {
    t = await createTestApp();
    storage = t.app.get(StorageService);
    await storage.put(source, body, { contentType: 'application/pdf' });
  });

  afterAll(async () => {
    await storage.delete(source);
    await storage.delete(target);
    await t.close();
  });

  it('copies the bytes to a new key and leaves the original in place', async () => {
    await storage.copy(source, target);
    expect(await bytesOf((await storage.get(target)).body)).toEqual(body);
    expect(await bytesOf((await storage.get(source)).body)).toEqual(body);
  });

  it('deleting the copy does not touch the original', async () => {
    await storage.delete(target);
    await expect(storage.get(target)).rejects.toThrow();
    expect(await bytesOf((await storage.get(source)).body)).toEqual(body);
  });

  it('fails loudly when the source is missing', async () => {
    await expect(storage.copy(`tests/storage-copy/${randomUUID()}.pdf`, target)).rejects.toThrow();
  });

  it('keeps template objects outside every envelope prefix', () => {
    expect(target).toMatch(/^tenants\/[^/]+\/templates\/[^/]+\/original-[^/]+\.pdf$/);
    expect(target).not.toContain('/envelopes/');
  });
});
