import type { Response } from 'express'
import { getObject } from '../storage/minio.js'
import { AppError } from './middleware/error.js'

/**
 * Stream a stored image back to an already-authorized caller. Never
 * cacheable by shared caches — image access is tied to the caller's session,
 * not to the URL, so an intermediary must not reuse a response across users.
 */
export async function streamImage(res: Response, key: string): Promise<void> {
  let object
  try {
    object = await getObject(key)
  } catch {
    throw new AppError(404, 'IMAGE_NOT_FOUND', 'Image not found')
  }

  res.setHeader('Content-Type', object.contentType)
  res.setHeader('Cache-Control', 'private, no-store')
  object.body.pipe(res)
}
