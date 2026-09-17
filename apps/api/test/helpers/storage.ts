import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

/** Reads an object straight from the test bucket, bypassing the API. */
export async function readStoredObject(key: string): Promise<Buffer> {
  const env = process.env;
  const client = new S3Client({
    region: env.S3_REGION ?? 'us-east-1',
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    },
  });
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return Buffer.from((await result.Body?.transformToByteArray()) ?? []);
  } finally {
    client.destroy();
  }
}
