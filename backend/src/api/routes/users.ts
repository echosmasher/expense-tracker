import { Router } from 'express'
import bcrypt from 'bcrypt'
import multer from 'multer'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'
import { uploadFile, getReceiptUrl } from '../../storage/minio.js'
import { sanitizeImage } from '../../services/imageSanitizer.js'

const router = Router()
const BCRYPT_ROUNDS = 12

// All user routes require authentication
router.use(requireAuth)

// ─── Avatar upload config ───────────────────────────────────────────────────
const AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const AVATAR_MAX_BYTES = 5 * 1024 * 1024 // 5 MB

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (AVATAR_MIME_TYPES.has(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new AppError(400, 'INVALID_FILE_TYPE', 'Only JPEG, PNG, and WebP images are accepted'))
    }
  },
})

// ─── Helper: fetch full user profile ────────────────────────────────────────
async function fetchProfile(userId: string) {
  const userResult = await db.query<{
    id: string; email: string; name: string; avatar_key: string | null; preferences: Record<string, unknown>
  }>(
    'SELECT id, email, name, avatar_key, preferences FROM users WHERE id = $1',
    [userId]
  )
  const user = userResult.rows[0]
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found')

  const cardsResult = await db.query<{ id: string; last_four: string; label: string }>(
    'SELECT id, last_four, label FROM cards WHERE user_id = $1 ORDER BY created_at',
    [userId]
  )

  let avatarUrl: string | null = null
  if (user.avatar_key) {
    avatarUrl = await getReceiptUrl(user.avatar_key, 3600)
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl,
    preferences: {
      theme: (user.preferences.theme as string) ?? 'dark',
      notifyNewExpense: user.preferences.notifyNewExpense ?? true,
      notifySettlement: user.preferences.notifySettlement ?? true,
      notifyInvite: user.preferences.notifyInvite ?? true,
    },
    cards: cardsResult.rows.map((c) => ({
      id: c.id,
      lastFour: c.last_four,
      label: c.label,
    })),
  }
}

// ─── GET /users/me ──────────────────────────────────────────────────────────
router.get('/me', async (req, res, next) => {
  try {
    res.json(await fetchProfile(req.user!.userId))
  } catch (err) {
    next(err)
  }
})

// ─── PATCH /users/me ────────────────────────────────────────────────────────
const UpdateMeSchema = z.object({
  name: z.string().min(1).optional(),
})

router.patch('/me', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const body = UpdateMeSchema.parse(req.body)

    if (body.name) {
      await db.query('UPDATE users SET name = $1, updated_at = now() WHERE id = $2', [body.name, userId])
    }

    res.json(await fetchProfile(userId))
  } catch (err) {
    next(err)
  }
})

// ─── POST /users/me/password ────────────────────────────────────────────────
const ChangePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
})

router.post('/me/password', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const body = ChangePasswordSchema.parse(req.body)

    const result = await db.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    )
    const user = result.rows[0]
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found')

    const valid = await bcrypt.compare(body.currentPassword, user.password_hash)
    if (!valid) throw new AppError(400, 'WRONG_PASSWORD', 'Current password is incorrect')

    const newHash = await bcrypt.hash(body.newPassword, BCRYPT_ROUNDS)
    await db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [newHash, userId])

    res.json({ message: 'Password updated' })
  } catch (err) {
    next(err)
  }
})

// ─── POST /users/me/avatar ──────────────────────────────────────────────────
router.post('/me/avatar', avatarUpload.single('avatar'), async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const file = req.file
    if (!file) throw new AppError(400, 'NO_FILE', 'No avatar file provided')

    // Strip metadata (incl. GPS EXIF) and validate the bytes are a real image.
    const image = await sanitizeImage(file.buffer)
    const key = `avatars/${userId}/${Date.now()}.${image.ext}`
    await uploadFile(key, image.buffer, image.mimetype)

    await db.query('UPDATE users SET avatar_key = $1, updated_at = now() WHERE id = $2', [key, userId])

    const avatarUrl = await getReceiptUrl(key, 3600)
    res.json({ avatarUrl })
  } catch (err) {
    next(err)
  }
})

// ─── PATCH /users/me/preferences ────────────────────────────────────────────
const UpdatePreferencesSchema = z.object({
  theme: z.enum(['light', 'dark']).optional(),
  notifyNewExpense: z.boolean().optional(),
  notifySettlement: z.boolean().optional(),
  notifyInvite: z.boolean().optional(),
})

router.patch('/me/preferences', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const body = UpdatePreferencesSchema.parse(req.body)

    // Merge into existing preferences
    await db.query(
      `UPDATE users SET preferences = preferences || $1::jsonb, updated_at = now() WHERE id = $2`,
      [JSON.stringify(body), userId]
    )

    const profile = await fetchProfile(userId)
    res.json(profile.preferences)
  } catch (err) {
    next(err)
  }
})

// ─── DELETE /users/me ───────────────────────────────────────────────────────
const DeleteAccountSchema = z.object({
  password: z.string(),
})

router.delete('/me', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const body = DeleteAccountSchema.parse(req.body)

    const result = await db.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    )
    const user = result.rows[0]
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found')

    const valid = await bcrypt.compare(body.password, user.password_hash)
    if (!valid) throw new AppError(400, 'WRONG_PASSWORD', 'Password is incorrect')

    // CASCADE deletes handle cards, refresh_tokens, household_members, etc.
    await db.query('DELETE FROM users WHERE id = $1', [userId])

    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

// ─── POST /users/me/cards ───────────────────────────────────────────────────
const AddCardSchema = z.object({
  lastFour: z.string().length(4).regex(/^\d{4}$/),
  label: z.string().min(1),
})

router.post('/me/cards', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const body = AddCardSchema.parse(req.body)

    const result = await db.query<{ id: string; last_four: string; label: string }>(
      'INSERT INTO cards (user_id, last_four, label) VALUES ($1, $2, $3) RETURNING id, last_four, label',
      [userId, body.lastFour, body.label]
    )
    const card = result.rows[0]!

    res.status(201).json({ id: card.id, lastFour: card.last_four, label: card.label })
  } catch (err) {
    next(err)
  }
})

// ─── DELETE /users/me/cards/:cardId ─────────────────────────────────────────
router.delete('/me/cards/:cardId', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const { cardId } = req.params

    const result = await db.query(
      'DELETE FROM cards WHERE id = $1 AND user_id = $2',
      [cardId, userId]
    )
    if (result.rowCount === 0) throw new AppError(404, 'CARD_NOT_FOUND', 'Card not found')

    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

export { router as usersRouter }
