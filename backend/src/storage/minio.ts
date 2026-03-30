import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'

const BUCKET = process.env.MINIO_BUCKET ?? 'receipts'

const s3 = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
  region: 'us-east-1', // MinIO ignores this but AWS SDK requires it
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? '',
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? '',
  },
  forcePathStyle: true, // required for MinIO
})

/** Ensure the receipts bucket exists (call once on startup). */
export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }))
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
    console.log(`Created MinIO bucket: ${BUCKET}`)
  }
}

/**
 * Upload a file to MinIO.
 * @returns The object key (store this in the database, never the URL directly).
 */
export async function uploadFile(
  key: string,
  buffer: Buffer,
  mimetype: string
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
    })
  )
  return key
}

/**
 * Generate a signed URL for a receipt image.
 * @param expirySeconds - Default 1 hour (3600s). Receipt images are never publicly accessible.
 */
export async function getReceiptUrl(
  key: string,
  expirySeconds = 3600
): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: expirySeconds }
  )
}
