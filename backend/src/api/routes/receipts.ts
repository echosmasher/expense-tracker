import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'
import { uploadFile, getReceiptUrl } from '../../storage/minio.js'
import { parseReceipt } from '../../services/receiptParser.js'
import { db } from '../../db/client.js'

const router = Router()
router.use(requireAuth)

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

const upload = multer({
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

// ─── POST /receipts/parse ─────────────────────────────────────────────────────

router.post('/parse', upload.single('receipt'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError(400, 'NO_FILE', 'No receipt file uploaded')
    }

    const userId = req.user!.userId
    const householdId = req.query['householdId']
    if (typeof householdId !== 'string' || !householdId) {
      throw new AppError(400, 'MISSING_HOUSEHOLD_ID', 'householdId query parameter is required')
    }

    // Verify user is a member of this household
    const memberCheck = await db.query(
      'SELECT id FROM household_members WHERE household_id = $1 AND user_id = $2',
      [householdId, userId]
    )
    if (memberCheck.rows.length === 0) {
      throw new AppError(403, 'FORBIDDEN', 'Not a member of this household')
    }

    // Upload to MinIO
    const ext = req.file.originalname.split('.').pop() ?? 'jpg'
    const key = `receipts/${householdId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    await uploadFile(key, req.file.buffer, req.file.mimetype)

    // Parse receipt with Anthropic
    const parsed = await parseReceipt(req.file.buffer, req.file.mimetype)

    // Match detected card last four against household member cards
    let matchedCardLastFour: string | null = parsed.detectedCardLastFour
    if (matchedCardLastFour) {
      const cardCheck = await db.query(
        `SELECT c.last_four FROM cards c
         JOIN household_members hm ON hm.user_id = c.user_id
         WHERE hm.household_id = $1 AND c.last_four = $2`,
        [householdId, matchedCardLastFour]
      )
      if (cardCheck.rows.length === 0) {
        matchedCardLastFour = null // detected but not registered in household
      }
    }

    // Generate signed URL for the uploaded receipt
    const receiptImageUrl = await getReceiptUrl(key)

    res.json({
      receiptImageKey: key,
      receiptImageUrl,
      store: parsed.store,
      date: parsed.date,
      detectedCardLastFour: matchedCardLastFour,
      items: parsed.items,
    })
  } catch (err) {
    next(err)
  }
})

export { router as receiptsRouter }
