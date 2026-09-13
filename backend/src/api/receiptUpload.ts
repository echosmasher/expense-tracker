import multer from 'multer'
import { AppError } from './middleware/error.js'

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

/** Shared multer config for the two `from-receipt` routes (household + project). */
export const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new AppError(400, 'INVALID_FILE_TYPE', 'Only JPEG, PNG, WebP, and GIF images are accepted'))
    }
  },
})
