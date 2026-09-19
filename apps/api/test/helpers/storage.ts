import {
  GetObjectCommand,
  GetObjectRetentionCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/** A client for the test buckets, with the same credentials as the API, bypassing it. */
export function testS3Client(): S3Client {
  const env = process.env;
  return new S3Client({
    region: env.S3_REGION ?? 'us-east-1',
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/** Reads an object straight from the test bucket, bypassing the API. */
export async function readStoredObject(key: string): Promise<Buffer> {
  const client = testS3Client();
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
    return Buffer.from((await result.Body?.transformToByteArray()) ?? []);
  } finally {
    client.destroy();
  }
}

/** Writes an object straight into the test bucket, bypassing the API. */
export async function putStoredObject(key: string, body: Buffer): Promise<void> {
  const client = testS3Client();
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: 'application/pdf',
      }),
    );
  } finally {
    client.destroy();
  }
}

/** Reads one version of an object in the locked test bucket, with its retention. */
export async function readSealedObject(
  key: string,
  versionId: string,
): Promise<{ body: Buffer; mode?: string; retainUntil?: Date }> {
  const client = testS3Client();
  const Bucket = process.env.S3_SEALED_BUCKET ?? `${process.env.S3_BUCKET}-sealed`;
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket, Key: key, VersionId: versionId }),
    );
    const { Retention } = await client.send(
      new GetObjectRetentionCommand({ Bucket, Key: key, VersionId: versionId }),
    );
    return {
      body: Buffer.from((await result.Body?.transformToByteArray()) ?? []),
      mode: Retention?.Mode,
      retainUntil: Retention?.RetainUntilDate,
    };
  } finally {
    client.destroy();
  }
}
