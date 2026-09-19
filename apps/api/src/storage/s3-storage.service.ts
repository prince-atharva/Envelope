import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  type PutObjectCommandInput,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../config/app-config';
import { StorageService, type StoredObject } from './storage.service';

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}

/** S3 API storage: MinIO locally, Cloudflare R2 or AWS S3 in production. */
@Injectable()
export class S3StorageService extends StorageService implements OnModuleDestroy {
  readonly bucket: string;
  readonly sealedBucket: string;
  private readonly retentionMode: AppConfig['SEALED_RETENTION_MODE'];
  private readonly retentionDays: number;
  private readonly client: S3Client;

  constructor(
    config: AppConfig,
    @InjectPinoLogger(S3StorageService.name) private readonly logger: PinoLogger,
  ) {
    super();
    this.bucket = config.S3_BUCKET;
    this.sealedBucket = config.S3_SEALED_BUCKET;
    this.retentionMode = config.SEALED_RETENTION_MODE;
    this.retentionDays = config.SEALED_RETENTION_DAYS;
    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
      // MinIO and R2 do not support every optional checksum the SDK now sends by default.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async put(
    key: string,
    body: Buffer,
    options: { contentType: string; metadata?: Record<string, string> },
  ): Promise<void> {
    await this.write({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: options.contentType,
      ContentLength: body.length,
      Metadata: options.metadata,
    });
  }

  async putSealed(
    key: string,
    body: Buffer,
    options: { contentType: string; metadata?: Record<string, string> },
  ): Promise<{ versionId: string; retainUntil: Date }> {
    const retainUntil = new Date(Date.now() + this.retentionDays * 24 * 3600 * 1000);
    const { VersionId } = await this.write({
      Bucket: this.sealedBucket,
      Key: key,
      Body: body,
      ContentType: options.contentType,
      ContentLength: body.length,
      Metadata: options.metadata,
      // S3 requires an integrity header on any write that sets a retention.
      ContentMD5: createHash('md5').update(body).digest('base64'),
      ObjectLockMode: this.retentionMode,
      ObjectLockRetainUntilDate: retainUntil,
    });
    if (!VersionId) {
      // Only a versioned bucket returns one, and only a bucket created with
      // Object Lock is versioned: without it, nothing was locked.
      this.logger.error({ bucket: this.sealedBucket, key }, 'Sealed bucket is not versioned');
      throw new Error(`Bucket ${this.sealedBucket} is not versioned; create it with Object Lock`);
    }
    return { versionId: VersionId, retainUntil };
  }

  get(key: string): Promise<StoredObject> {
    return this.read(this.bucket, key);
  }

  getSealed(key: string, versionId: string): Promise<StoredObject> {
    return this.read(this.sealedBucket, key, versionId);
  }

  private async write(input: PutObjectCommandInput): Promise<{ VersionId?: string }> {
    const started = performance.now();
    const where = {
      bucket: input.Bucket,
      key: input.Key,
      bytes: input.ContentLength,
      ...(input.ObjectLockMode
        ? { lockMode: input.ObjectLockMode, retainUntil: input.ObjectLockRetainUntilDate }
        : {}),
    };
    let result: { VersionId?: string };
    try {
      result = await this.client.send(new PutObjectCommand(input));
    } catch (error) {
      this.logger.error(
        { err: error, ...where, durationMs: elapsed(started) },
        'Storage write failed',
      );
      throw error;
    }
    this.logger.info(
      { ...where, versionId: result.VersionId, durationMs: elapsed(started) },
      'Stored object',
    );
    return result;
  }

  private async read(bucket: string, key: string, versionId?: string): Promise<StoredObject> {
    const started = performance.now();
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }),
      );
      this.logger.info(
        { bucket, key, versionId, bytes: result.ContentLength, durationMs: elapsed(started) },
        'Read object',
      );
      return {
        body: result.Body as Readable,
        contentLength: result.ContentLength,
        contentType: result.ContentType,
      };
    } catch (error) {
      this.logger.error(
        { err: error, bucket, key, versionId, durationMs: elapsed(started) },
        'Storage read failed',
      );
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      this.logger.info({ bucket: this.bucket, key }, 'Deleted object');
    } catch (error) {
      this.logger.error({ err: error, bucket: this.bucket, key }, 'Storage delete failed');
      throw error;
    }
  }

  async ping(): Promise<void> {
    await Promise.all(
      [this.bucket, this.sealedBucket].map((bucket) =>
        this.client.send(new HeadBucketCommand({ Bucket: bucket })),
      ),
    );
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
