import { Router } from 'express'
import { z } from 'zod'
import crypto from 'crypto'
import { db } from '../../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'
import { sendInviteEmail } from '../../services/email.js'

const router = Router()
router.use(requireAuth)

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function requireAdmin(householdId: string, userId: string): Promise<void> {
  const result = await db.query(
    "SELECT id FROM household_members WHERE household_id = $1 AND user_id = $2 AND role = 'admin'",
    [householdId, userId]
  )
  if (result.rows.length === 0) throw new AppError(403, 'ADMIN_ONLY', 'Only the household admin can perform this action')
}

async function getHouseholdOrThrow(householdId: string, userId: string) {
  // Verify membership
  const memberCheck = await db.query(
    'SELECT id FROM household_members WHERE household_id = $1 AND user_id = $2',
    [householdId, userId]
  )
  if (memberCheck.rows.length === 0) throw new AppError(403, 'FORBIDDEN', 'Not a member of this household')

  const result = await db.query<{
    id: string; name: string; address: string; status: string; current_allocation_key_id: string | null
  }>(
    'SELECT id, name, address, status, current_allocation_key_id FROM households WHERE id = $1',
    [householdId]
  )
  const household = result.rows[0]
  if (!household) throw new AppError(404, 'HOUSEHOLD_NOT_FOUND', 'Household not found')
  return household
}

async function buildHouseholdResponse(householdId: string, allocationKeyId: string | null) {
  const [membersResult, tagsResult, keywordsResult] = await Promise.all([
    db.query<{ user_id: string; name: string; role: string }>(
      `SELECT hm.user_id, u.name, hm.role
       FROM household_members hm JOIN users u ON u.id = hm.user_id
       WHERE hm.household_id = $1 ORDER BY hm.joined_at`,
      [householdId]
    ),
    db.query<{ id: string; name: string; is_personal: boolean }>(
      'SELECT id, name, is_personal FROM tags WHERE household_id = $1 ORDER BY name',
      [householdId]
    ),
    db.query<{ keyword: string }>(
      'SELECT keyword FROM personal_keywords WHERE household_id = $1 ORDER BY keyword',
      [householdId]
    ),
  ])

  let currentAllocationKey: Array<{ userId: string; name: string; shareBp: number }> = []
  if (allocationKeyId) {
    const sharesResult = await db.query<{ user_id: string; name: string; share_bp: number }>(
      `SELECT aks.user_id, u.name, aks.share_bp
       FROM allocation_key_shares aks JOIN users u ON u.id = aks.user_id
       WHERE aks.allocation_key_id = $1`,
      [allocationKeyId]
    )
    currentAllocationKey = sharesResult.rows.map((s) => ({
      userId: s.user_id,
      name: s.name,
      shareBp: s.share_bp,
    }))
  }

  return {
    members: membersResult.rows.map((m) => ({ userId: m.user_id, name: m.name, role: m.role })),
    currentAllocationKey,
    tags: tagsResult.rows.map((t) => ({ id: t.id, name: t.name, isPersonal: t.is_personal })),
    personalKeywords: keywordsResult.rows.map((k) => k.keyword),
  }
}

// ─── POST /households ────────────────────────────────────────────────────────
const AllocationShareSchema = z.object({
  userId: z.string().uuid(),
  shareBp: z.number().int().positive(),
})

const CreateHouseholdSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  // At creation time the household has one member (admin), so only admin's share is sent.
  // The allocation key is updated via PATCH once the second member has accepted their invite.
  allocationKey: z.array(AllocationShareSchema).min(1),
})

router.post('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const body = CreateHouseholdSchema.parse(req.body)

    const totalBp = body.allocationKey.reduce((sum, s) => sum + s.shareBp, 0)
    if (totalBp !== 10_000) {
      throw new AppError(400, 'ALLOCATION_KEY_MUST_SUM_TO_10000', 'Allocation key shares must sum to 10000 basis points')
    }

    const household = await db.transaction(async (client) => {
      // Create household (no allocation key yet)
      const hhResult = await client.query<{ id: string }>(
        "INSERT INTO households (name, address, status) VALUES ($1, $2, 'pending') RETURNING id",
        [body.name, body.address ?? '']
      )
      const householdId = hhResult.rows[0]!.id

      // Create allocation key
      const keyResult = await client.query<{ id: string }>(
        'INSERT INTO allocation_keys (household_id) VALUES ($1) RETURNING id',
        [householdId]
      )
      const keyId = keyResult.rows[0]!.id

      // Insert shares
      for (const share of body.allocationKey) {
        await client.query(
          'INSERT INTO allocation_key_shares (allocation_key_id, user_id, share_bp) VALUES ($1, $2, $3)',
          [keyId, share.userId, share.shareBp]
        )
      }

      // Set current allocation key
      await client.query(
        'UPDATE households SET current_allocation_key_id = $1 WHERE id = $2',
        [keyId, householdId]
      )

      // Add creator as admin
      await client.query(
        "INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'admin')",
        [householdId, userId]
      )

      // Seed default tags
      await client.query(
        "INSERT INTO tags (household_id, name, is_personal) VALUES ($1, 'Household', false), ($1, 'Personal', true)",
        [householdId]
      )

      return { id: householdId, keyId }
    })

    const [hhResult, details] = await Promise.all([
      db.query<{ id: string; name: string; address: string; status: string }>(
        'SELECT id, name, address, status FROM households WHERE id = $1',
        [household.id]
      ),
      buildHouseholdResponse(household.id, household.keyId),
    ])

    res.status(201).json({ ...hhResult.rows[0]!, ...details })
  } catch (err) {
    next(err)
  }
})

// ─── GET /households (list mine) ─────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const result = await db.query<{
      id: string; name: string; address: string; status: string; current_allocation_key_id: string | null
    }>(
      `SELECT h.id, h.name, h.address, h.status, h.current_allocation_key_id
       FROM households h
       JOIN household_members hm ON hm.household_id = h.id
       WHERE hm.user_id = $1
       ORDER BY hm.joined_at`,
      [userId]
    )
    const households = await Promise.all(
      result.rows.map(async (h) => {
        const details = await buildHouseholdResponse(h.id, h.current_allocation_key_id)
        return { id: h.id, name: h.name, address: h.address, status: h.status, ...details }
      })
    )
    res.json(households)
  } catch (err) {
    next(err)
  }
})

// ─── GET /households/:householdId ────────────────────────────────────────────
router.get('/:householdId', async (req, res, next) => {
  try {
    const { householdId } = req.params
    const userId = req.user!.userId

    const hh = await getHouseholdOrThrow(householdId, userId)
    const details = await buildHouseholdResponse(householdId, hh.current_allocation_key_id)

    res.json({ id: hh.id, name: hh.name, address: hh.address, status: hh.status, ...details })
  } catch (err) {
    next(err)
  }
})

// ─── PATCH /households/:householdId ─────────────────────────────────────────
const UpdateHouseholdSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  personalKeywords: z.array(z.string()).optional(),
  newAllocationKey: z.array(AllocationShareSchema).optional(),
})

router.patch('/:householdId', async (req, res, next) => {
  try {
    const { householdId } = req.params
    const userId = req.user!.userId

    await requireAdmin(householdId, userId)
    const body = UpdateHouseholdSchema.parse(req.body)

    if (body.newAllocationKey) {
      const totalBp = body.newAllocationKey.reduce((sum, s) => sum + s.shareBp, 0)
      if (totalBp !== 10_000) {
        throw new AppError(400, 'ALLOCATION_KEY_MUST_SUM_TO_10000', 'Allocation key shares must sum to 10000 basis points')
      }
    }

    await db.transaction(async (client) => {
      if (body.name || body.address) {
        const updates: string[] = []
        const values: unknown[] = []
        let i = 1
        if (body.name) { updates.push(`name = $${i++}`); values.push(body.name) }
        if (body.address) { updates.push(`address = $${i++}`); values.push(body.address) }
        updates.push(`updated_at = now()`)
        values.push(householdId)
        await client.query(`UPDATE households SET ${updates.join(', ')} WHERE id = $${i}`, values)
      }

      if (body.personalKeywords !== undefined) {
        await client.query('DELETE FROM personal_keywords WHERE household_id = $1', [householdId])
        for (const kw of body.personalKeywords) {
          await client.query(
            'INSERT INTO personal_keywords (household_id, keyword) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [householdId, kw.toLowerCase()]
          )
        }
      }

      if (body.newAllocationKey) {
        const keyResult = await client.query<{ id: string }>(
          'INSERT INTO allocation_keys (household_id) VALUES ($1) RETURNING id',
          [householdId]
        )
        const keyId = keyResult.rows[0]!.id
        for (const share of body.newAllocationKey) {
          await client.query(
            'INSERT INTO allocation_key_shares (allocation_key_id, user_id, share_bp) VALUES ($1, $2, $3)',
            [keyId, share.userId, share.shareBp]
          )
        }
        await client.query(
          'UPDATE households SET current_allocation_key_id = $1 WHERE id = $2',
          [keyId, householdId]
        )
      }
    })

    const hh = await getHouseholdOrThrow(householdId, userId)
    const details = await buildHouseholdResponse(householdId, hh.current_allocation_key_id)
    res.json({ id: hh.id, name: hh.name, address: hh.address, status: hh.status, ...details })
  } catch (err) {
    next(err)
  }
})

// ─── POST /households/:householdId/invites ───────────────────────────────────
const InviteSchema = z.object({ email: z.string().email() })

router.post('/:householdId/invites', async (req, res, next) => {
  try {
    const { householdId } = req.params
    const userId = req.user!.userId

    await requireAdmin(householdId, userId)
    const { email } = InviteSchema.parse(req.body)

    // Check not already a member
    const memberCheck = await db.query(
      `SELECT hm.id FROM household_members hm
       JOIN users u ON u.id = hm.user_id
       WHERE hm.household_id = $1 AND u.email = $2`,
      [householdId, email]
    )
    if (memberCheck.rows.length > 0) {
      throw new AppError(409, 'ALREADY_MEMBER', 'This user is already a member of the household')
    }

    const raw = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    const result = await db.query<{ id: string; email: string; expires_at: Date }>(
      'INSERT INTO invites (household_id, email, token_hash, expires_at) VALUES ($1, $2, $3, $4) RETURNING id, email, expires_at',
      [householdId, email, tokenHash, expiresAt]
    )
    const invite = result.rows[0]!

    // Get household name for email
    const hhResult = await db.query<{ name: string }>(
      'SELECT name FROM households WHERE id = $1',
      [householdId]
    )
    const householdName = hhResult.rows[0]?.name ?? 'your household'

    await sendInviteEmail({ to: email, token: raw, householdName })

    res.status(201).json({ id: invite.id, email: invite.email, expiresAt: invite.expires_at })
  } catch (err) {
    next(err)
  }
})

export { router as householdsRouter }
