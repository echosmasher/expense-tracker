import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { AppError } from '../middleware/error.js'
import { sendInviteEmail } from '../../services/email.js'
import { authLimiter } from '../middleware/rateLimit.js'

const router = Router()
router.use(authLimiter)

const BCRYPT_ROUNDS = 12
const ACCESS_TOKEN_TTL = '15m'
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function issueAccessToken(userId: string, email: string): string {
  const secret = process.env.JWT_ACCESS_SECRET
  if (!secret) throw new Error('JWT_ACCESS_SECRET not configured')
  return jwt.sign({ userId, email }, secret, { expiresIn: ACCESS_TOKEN_TTL })
}

async function issueRefreshToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(64).toString('hex')
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS)
  await db.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hash, expiresAt]
  )
  return raw
}

function setRefreshCookie(res: import('express').Response, token: string) {
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: REFRESH_TOKEN_TTL_MS,
    path: '/api/v1/auth',
  })
}

// ─── POST /auth/register ─────────────────────────────────────────────────────
const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
})

router.post('/register', async (req, res, next) => {
  try {
    const body = RegisterSchema.parse(req.body)

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [body.email])
    if (existing.rows.length > 0) {
      throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists')
    }

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS)
    const result = await db.query<{ id: string; email: string; name: string }>(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [body.email, passwordHash, body.name]
    )
    const user = result.rows[0]!

    const accessToken = issueAccessToken(user.id, user.email)
    const refreshToken = await issueRefreshToken(user.id)
    setRefreshCookie(res, refreshToken)

    res.status(201).json({ accessToken, user })
  } catch (err) {
    next(err)
  }
})

// ─── POST /auth/login ────────────────────────────────────────────────────────
const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

router.post('/login', async (req, res, next) => {
  try {
    const body = LoginSchema.parse(req.body)

    const result = await db.query<{ id: string; email: string; name: string; password_hash: string }>(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [body.email]
    )
    const user = result.rows[0]
    if (!user) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password')

    const valid = await bcrypt.compare(body.password, user.password_hash)
    if (!valid) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password')

    const accessToken = issueAccessToken(user.id, user.email)
    const refreshToken = await issueRefreshToken(user.id)
    setRefreshCookie(res, refreshToken)

    res.json({ accessToken, user: { id: user.id, email: user.email, name: user.name } })
  } catch (err) {
    next(err)
  }
})

// ─── POST /auth/refresh ──────────────────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const raw: unknown = req.cookies['refresh_token']
    if (typeof raw !== 'string' || !raw) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'No refresh token provided')
    }

    const hash = crypto.createHash('sha256').update(raw).digest('hex')
    const result = await db.query<{ id: string; user_id: string; expires_at: Date; revoked_at: Date | null }>(
      'SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1',
      [hash]
    )
    const token = result.rows[0]
    if (!token) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token')
    if (token.revoked_at) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token revoked')
    if (new Date() > token.expires_at) throw new AppError(401, 'REFRESH_TOKEN_EXPIRED', 'Refresh token expired')

    // Rotate: revoke old, issue new
    await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [token.id])

    const userResult = await db.query<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE id = $1',
      [token.user_id]
    )
    const user = userResult.rows[0]!

    const accessToken = issueAccessToken(user.id, user.email)
    const newRefreshToken = await issueRefreshToken(user.id)
    setRefreshCookie(res, newRefreshToken)

    res.json({ accessToken })
  } catch (err) {
    next(err)
  }
})

// ─── POST /auth/logout ───────────────────────────────────────────────────────
router.post('/logout', async (req, res, next) => {
  try {
    const raw: unknown = req.cookies['refresh_token']
    if (typeof raw === 'string' && raw) {
      const hash = crypto.createHash('sha256').update(raw).digest('hex')
      await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [hash])
    }
    res.clearCookie('refresh_token', { path: '/api/v1/auth' })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

// ─── GET /auth/invite-info ───────────────────────────────────────────────────
router.get('/invite-info', async (req, res, next) => {
  try {
    const token = req.query['token']
    if (typeof token !== 'string' || !token) {
      throw new AppError(400, 'MISSING_TOKEN', 'token query parameter is required')
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const inviteResult = await db.query<{
      email: string; household_id: string; accepted_at: Date | null; expires_at: Date
    }>(
      `SELECT i.email, i.household_id, i.accepted_at, i.expires_at, h.name as household_name
       FROM invites i JOIN households h ON h.id = i.household_id
       WHERE i.token_hash = $1`,
      [tokenHash]
    )
    const invite = inviteResult.rows[0] as (typeof inviteResult.rows[0] & { household_name: string }) | undefined
    if (!invite) throw new AppError(404, 'INVALID_TOKEN', 'Invalid invite token')
    if (invite.accepted_at) throw new AppError(410, 'TOKEN_ALREADY_USED', 'Invite already accepted')
    if (new Date() > invite.expires_at) throw new AppError(410, 'TOKEN_EXPIRED', 'Invite has expired')

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [invite.email])
    res.json({
      email: invite.email,
      householdName: invite.household_name,
      isNewUser: existing.rows.length === 0,
    })
  } catch (err) {
    next(err)
  }
})

// ─── POST /auth/accept-invite ────────────────────────────────────────────────
const AcceptInviteSchema = z.object({
  token: z.string(),
  name: z.string().min(1).optional(),
  password: z.string().min(8).optional(),
})

router.post('/accept-invite', async (req, res, next) => {
  try {
    const body = AcceptInviteSchema.parse(req.body)
    const tokenHash = crypto.createHash('sha256').update(body.token).digest('hex')

    const inviteResult = await db.query<{
      id: string; household_id: string; email: string; accepted_at: Date | null; expires_at: Date
    }>(
      'SELECT id, household_id, email, accepted_at, expires_at FROM invites WHERE token_hash = $1',
      [tokenHash]
    )
    const invite = inviteResult.rows[0]
    if (!invite) throw new AppError(400, 'INVALID_TOKEN', 'Invalid invite token')
    if (invite.accepted_at) throw new AppError(400, 'TOKEN_ALREADY_USED', 'Invite already accepted')
    if (new Date() > invite.expires_at) throw new AppError(400, 'TOKEN_EXPIRED', 'Invite has expired')

    let userId: string

    // Check if user already exists
    const existingUser = await db.query<{ id: string; email: string; name: string }>(
      'SELECT id, email, name FROM users WHERE email = $1',
      [invite.email]
    )

    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0]!.id
    } else {
      if (!body.name || !body.password) {
        throw new AppError(400, 'VALIDATION_ERROR', 'name and password required for new accounts')
      }
      const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS)
      const newUser = await db.query<{ id: string }>(
        'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
        [invite.email, passwordHash, body.name]
      )
      userId = newUser.rows[0]!.id
    }

    await db.transaction(async (client) => {
      // Mark invite accepted
      await client.query('UPDATE invites SET accepted_at = now() WHERE id = $1', [invite.id])

      // Add to household (idempotent)
      await client.query(
        `INSERT INTO household_members (household_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT (household_id, user_id) DO NOTHING`,
        [invite.household_id, userId]
      )

      // Activate household if member count >= 2
      const countResult = await client.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM household_members WHERE household_id = $1',
        [invite.household_id]
      )
      const count = parseInt(countResult.rows[0]!.count, 10)
      if (count >= 2) {
        await client.query(
          "UPDATE households SET status = 'active' WHERE id = $1 AND status = 'pending'",
          [invite.household_id]
        )
      }
    })

    const userResult = await db.query<{ id: string; email: string; name: string }>(
      'SELECT id, email, name FROM users WHERE id = $1',
      [userId]
    )
    const user = userResult.rows[0]!

    const accessToken = issueAccessToken(user.id, user.email)
    const refreshToken = await issueRefreshToken(user.id)
    setRefreshCookie(res, refreshToken)

    res.json({ accessToken, user, householdId: invite.household_id })
  } catch (err) {
    next(err)
  }
})

export { router as authRouter }
