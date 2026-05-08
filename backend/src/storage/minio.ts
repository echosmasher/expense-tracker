import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'

const BUCKET = process.env.MINIO_BUCKET ?? 'receipts'
const INTERNAL_ENDPOINT = process.env.MINIO_ENDPOINT ?? 'http://localhost:9000'
// MINIO_PUBLIC_ENDPOINT is what the browser uses; falls back to internal when unset (dev).
const PUBLIC_ENDPOINT = process.env.MINIO_PUBLIC_ENDPOINT ?? INTERNAL_ENDPOINT

const credentials = {
  accessKeyId: process.env.MINIO_ACCESS_KEY ?? '',
  secretAccessKey: process.env.MINIO_SECRET_KEY ?? '',
}

// Used for server→MinIO traffic (uploads, bucket admin) over the Docker network.
const s3 = new S3Client({
  endpoint: INTERNAL_ENDPOINT,
  region: 'us-east-1', // MinIO ignores this but AWS SDK requires it
  credentials,
  forcePathStyle: true, // required for MinIO
})

// Used only to mint presigned URLs that the browser can resolve.
const s3Public = new S3Client({
  endpoint: PUBLIC_ENDPOINT,
  region: 'us-east-1',
  credentials,
  forcePathStyle: true,
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
    s3Public,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: expirySeconds }
  )
}
