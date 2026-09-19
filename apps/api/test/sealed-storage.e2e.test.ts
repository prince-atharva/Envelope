import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectRetentionCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageService } from '../src/storage/storage.service';
import { createTestApp, type TestApp } from './helpers/app';
import { testS3Client } from './helpers/storage';

async function bytesOf(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/**
 * The locked bucket really locks (ADR 0007). Run against MinIO, which enforces
 * Object Lock as S3 does. The test environment uses GOVERNANCE mode and a
 * one-day retention, so the files can be cleaned up afterwards.
 */
describe('sealed storage (e2e)', () => {
  let t: TestApp;
  let storage: StorageService;
  let s3: S3Client;
  const key = `tests/sealed-storage/${randomUUID()}.pdf`;
  const sealed = Buffer.from('%PDF-1.7 sealed test document\n');

  beforeAll(async () => {
    t = await createTestApp();
    storage = t.app.get(StorageService);
    s3 = testS3Client();
  });

  afterAll(async () => {
    // GOVERNANCE lets a user with the bypass permission remove locked versions.
    const { Versions = [], DeleteMarkers = [] } = await s3.send(
      new ListObjectVersionsCommand({ Bucket: storage.sealedBucket, Prefix: key }),
    );
    for (const { VersionId } of [...Versions, ...DeleteMarkers]) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: storage.sealedBucket,
          Key: key,
          VersionId,
          BypassGovernanceRetention: true,
        }),
      );
    }
    s3.destroy();
    await t.close();
  });

  it('writes a locked version and reads exactly that version back', async () => {
    const before = Date.now();
    const { versionId, retainUntil } = await storage.putSealed(key, sealed, {
      contentType: 'application/pdf',
    });
    expect(versionId).toBeTruthy();
    // SEALED_RETENTION_DAYS is 1 in tests.
    expect(retainUntil.getTime() - before).toBeGreaterThanOrEqual(24 * 3600 * 1000 - 1000);

    const retention = await s3.send(
      new GetObjectRetentionCommand({
        Bucket: storage.sealedBucket,
        Key: key,
        VersionId: versionId,
      }),
    );
    expect(retention.Retention?.Mode).toBe('GOVERNANCE');

    const stored = await storage.getSealed(key, versionId);
    expect((await bytesOf(stored.body)).equals(sealed)).toBe(true);
  });

  it('refuses to delete the locked version, and a newer write or a delete marker does not replace it', async () => {
    const { versionId } = await storage.putSealed(key, sealed, { contentType: 'application/pdf' });

    await expect(
      s3.send(
        new DeleteObjectCommand({ Bucket: storage.sealedBucket, Key: key, VersionId: versionId }),
      ),
    ).rejects.toThrow(/retention|locked|AccessDenied|WORM/i);

    // Neither of these touches the locked version: they add a newer version
    // and a delete marker on top of it.
    await s3.send(
      new PutObjectCommand({
        Bucket: storage.sealedBucket,
        Key: key,
        Body: Buffer.from('%PDF-1.7 a forgery\n'),
      }),
    );
    await s3.send(new DeleteObjectCommand({ Bucket: storage.sealedBucket, Key: key }));

    const stored = await storage.getSealed(key, versionId);
    expect((await bytesOf(stored.body)).equals(sealed)).toBe(true);
  });

  it('reports both buckets in the health check', async () => {
    await expect(storage.ping()).resolves.toBeUndefined();
  });
});
