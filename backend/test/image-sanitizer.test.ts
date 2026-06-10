// Unit tests for the upload sanitizer. No DB or external services: sharp
// generates the input images in-process, so these assert the security
// properties directly — metadata stripped, non-images rejected, size bounded.
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { sanitizeImage } from '../src/services/imageSanitizer.js'
import { AppError } from '../src/api/middleware/error.js'

describe('sanitizeImage', () => {
  it('strips EXIF metadata (e.g. GPS / copyright) from the output', async () => {
    const withExif = await sharp({
      create: { width: 64, height: 64, channels: 3, background: 'white' },
    })
      .withExif({ IFD0: { Copyright: 'secret-owner', ImageDescription: 'taken at home' } })
      .jpeg()
      .toBuffer()

    // Precondition: the input genuinely carries EXIF.
    expect((await sharp(withExif).metadata()).exif).toBeDefined()

    const out = await sanitizeImage(withExif)
    expect(out.mimetype).toBe('image/jpeg')
    expect((await sharp(out.buffer).metadata()).exif).toBeUndefined()
  })

  it('always re-encodes to JPEG regardless of input format (PNG in → JPEG out)', async () => {
    const png = await sharp({
      create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } },
    })
      .png()
      .toBuffer()

    const out = await sanitizeImage(png)
    expect(out.mimetype).toBe('image/jpeg')
    expect(out.ext).toBe('jpg')
    expect((await sharp(out.buffer).metadata()).format).toBe('jpeg')
  })

  it('caps the long edge at 2400px (downscales oversized uploads)', async () => {
    const huge = await sharp({
      create: { width: 5000, height: 1000, channels: 3, background: 'red' },
    })
      .jpeg()
      .toBuffer()

    const out = await sanitizeImage(huge)
    const meta = await sharp(out.buffer).metadata()
    expect(meta.width).toBeLessThanOrEqual(2400)
    expect(meta.height).toBeLessThanOrEqual(2400)
  })

  it('does not enlarge images already smaller than the cap', async () => {
    const small = await sharp({
      create: { width: 100, height: 80, channels: 3, background: 'blue' },
    })
      .jpeg()
      .toBuffer()

    const out = await sanitizeImage(small)
    const meta = await sharp(out.buffer).metadata()
    expect(meta.width).toBe(100)
    expect(meta.height).toBe(80)
  })

  it('rejects bytes that merely claim to be an image (random data)', async () => {
    await expect(sanitizeImage(Buffer.from('definitely not an image'))).rejects.toBeInstanceOf(
      AppError
    )
  })

  it('rejects a disguised non-image (PDF bytes)', async () => {
    const fakePdf = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj<<>>endobj\n')
    await expect(sanitizeImage(fakePdf)).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_IMAGE',
    })
  })
})
