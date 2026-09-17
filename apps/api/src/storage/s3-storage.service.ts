import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
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
  private readonly client: S3Client;

  constructor(
    config: AppConfig,
    @InjectPinoLogger(S3StorageService.name) private readonly logger: PinoLogger,
  ) {
    super();
    this.bucket = config.S3_BUCKET;
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
    const started = performance.now();
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: options.contentType,
          ContentLength: body.length,
          Metadata: options.metadata,
        }),
      );
    } catch (error) {
      this.logger.error(
        { err: error, bucket: this.bucket, key, bytes: body.length, durationMs: elapsed(started) },
        'Storage write failed',
      );
      throw error;
    }
    this.logger.info(
      { bucket: this.bucket, key, bytes: body.length, durationMs: elapsed(started) },
      'Stored object',
    );
  }

  async get(key: string): Promise<StoredObject> {
    const started = performance.now();
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      this.logger.info(
        { bucket: this.bucket, key, bytes: result.ContentLength, durationMs: elapsed(started) },
        'Read object',
      );
      return {
        body: result.Body as Readable,
        contentLength: result.ContentLength,
        contentType: result.ContentType,
      };
    } catch (error) {
      this.logger.error(
        { err: error, bucket: this.bucket, key, durationMs: elapsed(started) },
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
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
