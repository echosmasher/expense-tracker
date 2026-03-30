import { Router } from 'express'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'

const router = Router()

// All user routes require authentication
router.use(requireAuth)

// ─── GET /users/me ───────────────────────────────────────────────────────────
router.get('/me', async (req, res, next) => {
  try {
    const userId = req.user!.userId

    const userResult = await db.query<{ id: string; email: string; name: string }>(
      'SELECT id, email, name FROM users WHERE id = $1',
      [userId]
    )
    const user = userResult.rows[0]
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found')

    const cardsResult = await db.query<{ id: string; last_four: string; label: string }>(
      'SELECT id, last_four, label FROM cards WHERE user_id = $1 ORDER BY created_at',
      [userId]
    )

    res.json({
      ...user,
      cards: cardsResult.rows.map((c) => ({
        id: c.id,
        lastFour: c.last_four,
        label: c.label,
      })),
    })
  } catch (err) {
    next(err)
  }
})

// ─── PATCH /users/me ─────────────────────────────────────────────────────────
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

    const userResult = await db.query<{ id: string; email: string; name: string }>(
      'SELECT id, email, name FROM users WHERE id = $1',
      [userId]
    )
    const user = userResult.rows[0]!

    const cardsResult = await db.query<{ id: string; last_four: string; label: string }>(
      'SELECT id, last_four, label FROM cards WHERE user_id = $1 ORDER BY created_at',
      [userId]
    )

    res.json({
      ...user,
      cards: cardsResult.rows.map((c) => ({ id: c.id, lastFour: c.last_four, label: c.label })),
    })
  } catch (err) {
    next(err)
  }
})

// ─── POST /users/me/cards ────────────────────────────────────────────────────
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
