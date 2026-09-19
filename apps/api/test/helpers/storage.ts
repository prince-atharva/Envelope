import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

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
