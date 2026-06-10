/**
 * Image sanitization for user uploads (receipts, avatars).
 *
 * Uploaded bytes are untrusted: the MIME type is client-asserted (multer only
 * reads the declared header), and phone photos carry EXIF metadata — including
 * GPS coordinates — that would otherwise be stored in MinIO and, for receipts,
 * forwarded to OpenAI. Re-encoding every upload through sharp:
 *   - proves the bytes are a real, decodable raster image (garbage/polyglots
 *     and disguised non-images throw → rejected as 400 upstream),
 *   - drops ALL metadata (sharp does not copy EXIF/XMP/ICC unless asked), so no
 *     location data leaves the device,
 *   - auto-applies EXIF orientation then discards it, so receipts aren't sideways
 *     for the parser,
 *   - bounds the dimensions, capping the byte size sent to the OpenAI vision API.
 */
import sharp from 'sharp'
import { AppError } from '../api/middleware/error.js'

// Receipts are documents — 2400px on the long edge is plenty for OCR/vision and
// keeps the base64 payload to OpenAI bounded.
const MAX_DIMENSION = 2400
const JPEG_QUALITY = 85

export interface SanitizedImage {
  buffer: Buffer
  mimetype: string
  ext: string
}

export async function sanitizeImage(input: Buffer): Promise<SanitizedImage> {
  try {
    const buffer = await sharp(input, { failOn: 'error' })
      .rotate() // bake in EXIF orientation before metadata is stripped
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY }) // re-encode; no .withMetadata() ⇒ metadata dropped
      .toBuffer()
    return { buffer, mimetype: 'image/jpeg', ext: 'jpg' }
  } catch {
    // sharp throws on non-images, truncated data, or decode bombs it refuses.
    throw new AppError(400, 'INVALID_IMAGE', 'Uploaded file is not a valid image')
  }
}
