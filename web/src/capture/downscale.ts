const MAX_EDGE_PX = 1600
const JPEG_QUALITY = 0.8

/**
 * Downscales an image to at most MAX_EDGE_PX on its long edge and re-encodes
 * it as JPEG, so a scan is small enough to upload on a mobile connection and
 * never carries a format (e.g. HEIC) the API rejects. Falls back to the
 * original blob if it can't be decoded — see spec 004 plan.md "Scan".
 */
export async function downscaleImage(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    try {
      const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height))
      const width = Math.round(bitmap.width * scale)
      const height = Math.round(bitmap.height * scale)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 2D context unavailable')
      ctx.drawImage(bitmap, 0, 0, width, height)

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
      if (!blob) throw new Error('JPEG encoding failed')
      return blob
    } finally {
      bitmap.close()
    }
  } catch {
    return file
  }
}
