import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3'
import type { Readable } from 'node:stream'

const BUCKET = process.env.MINIO_BUCKET ?? 'receipts'
const INTERNAL_ENDPOINT = process.env.MINIO_ENDPOINT ?? 'http://localhost:9000'

const credentials = {
  accessKeyId: process.env.MINIO_ACCESS_KEY ?? '',
  secretAccessKey: process.env.MINIO_SECRET_KEY ?? '',
}

// The object store is never reachable from outside the Docker network — every
// image request goes through an authenticated API route that streams the
// object server-side, so only this internal client is needed.
const s3 = new S3Client({
  endpoint: INTERNAL_ENDPOINT,
  region: 'us-east-1', // MinIO ignores this but AWS SDK requires it
  credentials,
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

export interface StoredObject {
  body: Readable
  contentType: string
}

/** Fetch an object's bytes for the API to stream back to an authenticated caller. */
export async function getObject(key: string): Promise<StoredObject> {
  const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  return {
    body: result.Body as Readable,
    contentType: result.ContentType ?? 'application/octet-stream',
  }
}
