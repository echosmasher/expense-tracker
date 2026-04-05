import { Router } from 'express'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'
import { broadcast } from '../../ws/server.js'
import { calculateSettlement } from '@expense-tracker/shared'
import { sendSettlementReadyEmail } from '../../services/email.js'
import { sendSettlementReadyPush, getHouseholdPushTokens } from '../../services/notifications.js'

const router = Router({ mergeParams: true })
router.use(requireAuth)

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireAdmin(householdId: string, userId: string) {
  const result = await db.query(
    "SELECT id FROM household_members WHERE household_id = $1 AND user_id = $2 AND role = 'admin'",
    [householdId, userId]
  )
  if (result.rows.length === 0) {
    throw new AppError(403, 'ADMIN_ONLY', 'Only the household admin can perform this action')
  }
}

async function requireActiveMember(householdId: string, userId: string) {
  const result = await db.query<{ status: string }>(
    `SELECT h.status FROM households h
     JOIN household_members hm ON hm.household_id = h.id
     WHERE h.id = $1 AND hm.user_id = $2`,
    [householdId, userId]
  )
  const row = result.rows[0]
  if (!row) throw new AppError(403, 'FORBIDDEN', 'Not a member of this household')
  if (row.status !== 'active') throw new AppError(403, 'HOUSEHOLD_NOT_ACTIVE', 'Household is not yet active')
}

async function buildSettlementResponse(settlementId: string) {
  const [settlementResult, balancesResult, txResult] = await Promise.all([
    db.query<{
      id: string; household_id: string | null; project_id: string | null
      period_month: number | null; period_year: number | null
      status: string; allocation_key_snapshot_id: string; created_at: Date
    }>(
      'SELECT * FROM settlements WHERE id = $1',
      [settlementId]
    ),
    db.query<{ user_id: string; name: string; balance_ore: number }>(
      `SELECT sb.user_id, u.name, sb.balance_ore
       FROM settlement_balances sb JOIN users u ON u.id = sb.user_id
       WHERE sb.settlement_id = $1`,
      [settlementId]
    ),
    db.query<{
      id: string
      from_user_id: string; from_name: string
      to_user_id: string; to_name: string
      amount_ore: number; paid_at: Date | null
    }>(
      `SELECT st.id, st.from_user_id, fu.name as from_name,
              st.to_user_id, tu.name as to_name, st.amount_ore, st.paid_at
       FROM settlement_transactions st
       JOIN users fu ON fu.id = st.from_user_id
       JOIN users tu ON tu.id = st.to_user_id
       WHERE st.settlement_id = $1`,
      [settlementId]
    ),
  ])

  const s = settlementResult.rows[0]!
  return {
    id: s.id,
    householdId: s.household_id,
    projectId: s.project_id,
    periodMonth: s.period_month,
    periodYear: s.period_year,
    status: s.status,
    createdAt: s.created_at,
    balances: balancesResult.rows.map((b) => ({
      userId: b.user_id,
      name: b.name,
      amountOre: b.balance_ore,
    })),
    transactions: txResult.rows.map((t) => ({
      id: t.id,
      fromUserId: t.from_user_id,
      fromName: t.from_name,
      toUserId: t.to_user_id,
      toName: t.to_name,
      amountOre: t.amount_ore,
      paidAt: t.paid_at,
    })),
  }
}

// ─── POST /households/:householdId/settlements ────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const { householdId } = req.params as { householdId: string }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)
    await requireAdmin(householdId, userId)

    // Get household to snapshot current allocation key
    const hhResult = await db.query<{
      id: string; name: string; current_allocation_key_id: string | null
    }>(
      'SELECT id, name, current_allocation_key_id FROM households WHERE id = $1',
      [householdId]
    )
    const household = hhResult.rows[0]
    if (!household?.current_allocation_key_id) {
      throw new AppError(400, 'NO_ALLOCATION_KEY', 'Household has no allocation key set')
    }

    // Determine settlement period: previous month
    const now = new Date()
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const periodYear = prevMonth.getFullYear()
    const periodMonth = prevMonth.getMonth() + 1 // 1-indexed

    // Check not already settled for this period
    const existing = await db.query(
      'SELECT id FROM settlements WHERE household_id = $1 AND period_year = $2 AND period_month = $3',
      [householdId, periodYear, periodMonth]
    )
    if (existing.rows.length > 0) {
      throw new AppError(409, 'ALREADY_SETTLED', 'Settlement for this period already exists')
    }

    // Fetch all confirmed household expenses for the period
    const expensesResult = await db.query<{
      id: string; total_amount_ore: number; purchased_by: string
    }>(
      `SELECT e.id, e.total_amount_ore, e.purchased_by
       FROM expenses e
       WHERE e.household_id = $1
         AND e.status = 'confirmed'
         AND EXTRACT(YEAR FROM e.expense_date) = $2
         AND EXTRACT(MONTH FROM e.expense_date) = $3`,
      [householdId, periodYear, periodMonth]
    )

    // Fetch allocation key shares with admin flag from household_members
    const sharesResult = await db.query<{ user_id: string; share_bp: number; role: string }>(
      `SELECT aks.user_id, aks.share_bp, hm.role
       FROM allocation_key_shares aks
       JOIN household_members hm
         ON hm.user_id = aks.user_id AND hm.household_id = $2
       WHERE aks.allocation_key_id = $1`,
      [household.current_allocation_key_id, householdId]
    )

    // Calculate settlement
    const calcExpenses = expensesResult.rows.map((e) => ({
      purchasedByUserId: e.purchased_by,
      householdAmountOre: Number(e.total_amount_ore),
    }))
    const calcShares = sharesResult.rows.map((s) => ({
      userId: s.user_id,
      shareBp: s.share_bp,
      isAdmin: s.role === 'admin',
    }))
    const { balances, transactions } = calculateSettlement(calcExpenses, calcShares)

    // Persist settlement
    const settlement = await db.transaction(async (client) => {
      const sResult = await client.query<{ id: string }>(
        `INSERT INTO settlements
           (household_id, period_year, period_month, status, allocation_key_snapshot_id, triggered_by_user_id)
         VALUES ($1, $2, $3, 'open', $4, $5)
         RETURNING id`,
        [householdId, periodYear, periodMonth, household.current_allocation_key_id, userId]
      )
      const settlementId = sResult.rows[0]!.id

      for (const balance of balances) {
        await client.query(
          'INSERT INTO settlement_balances (settlement_id, user_id, balance_ore) VALUES ($1, $2, $3)',
          [settlementId, balance.userId, balance.amountOre]
        )
      }

      for (const tx of transactions) {
        await client.query(
          `INSERT INTO settlement_transactions
             (settlement_id, from_user_id, to_user_id, amount_ore)
           VALUES ($1, $2, $3, $4)`,
          [settlementId, tx.fromUserId, tx.toUserId, tx.amountOre]
        )
      }

      return settlementId
    })

    // Broadcast settlement ready event
    broadcast(householdId, { type: 'settlement.ready', settlementId: settlement })

    // Send email to all household members
    const membersResult = await db.query<{ email: string; name: string }>(
      `SELECT u.email, u.name FROM users u
       JOIN household_members hm ON hm.user_id = u.id
       WHERE hm.household_id = $1`,
      [householdId]
    )
    const periodLabel = `${prevMonth.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })}`
    const memberMap = new Map(membersResult.rows.map((m) => [m.email, m.name]))
    // fetch user names by id for the email
    const userIds = [...new Set(transactions.flatMap((t) => [t.fromUserId, t.toUserId]))]
    const userRows = userIds.length > 0
      ? await db.query<{ id: string; name: string }>(
          `SELECT id, name FROM users WHERE id = ANY($1::uuid[])`,
          [userIds]
        )
      : { rows: [] as Array<{ id: string; name: string }> }
    const userNameMap = new Map(userRows.rows.map((u) => [u.id, u.name]))

    await sendSettlementReadyEmail({
      to: membersResult.rows.map((m) => m.email),
      householdName: household.name,
      periodLabel,
      transactions: transactions.map((t) => ({
        fromName: userNameMap.get(t.fromUserId) ?? t.fromUserId,
        toName: userNameMap.get(t.toUserId) ?? t.toUserId,
        amountOre: t.amountOre,
      })),
    })

    // Send iOS push notifications (non-blocking, best-effort)
    getHouseholdPushTokens(householdId, db).then((tokens) => {
      if (tokens.length > 0) {
        sendSettlementReadyPush({
          householdId,
          householdName: household.name,
          settlementId: settlement,
          tokens,
        })
      }
    }).catch(() => { /* non-fatal */ })

    const response = await buildSettlementResponse(settlement)
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
})

// ─── GET /households/:householdId/settlements ─────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { householdId } = req.params as { householdId: string }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)

    const result = await db.query<{
      id: string; period_year: number; period_month: number; status: string; created_at: Date
    }>(
      `SELECT id, period_year, period_month, status, created_at
       FROM settlements
       WHERE household_id = $1 AND project_id IS NULL
       ORDER BY period_year DESC, period_month DESC`,
      [householdId]
    )

    res.json({ settlements: result.rows.map((s) => ({
      id: s.id,
      periodYear: s.period_year,
      periodMonth: s.period_month,
      status: s.status,
      createdAt: s.created_at,
    })) })
  } catch (err) {
    next(err)
  }
})

// ─── GET /households/:householdId/settlements/:settlementId ──────────────────

router.get('/:settlementId', async (req, res, next) => {
  try {
    const { householdId, settlementId } = req.params as { householdId: string; settlementId: string }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)

    const check = await db.query(
      'SELECT id FROM settlements WHERE id = $1 AND household_id = $2',
      [settlementId, householdId]
    )
    if (check.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Settlement not found')

    const response = await buildSettlementResponse(settlementId)
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ─── PATCH /settlements/:settlementId/transactions/:transactionId ─────────────
// Note: This route is mounted separately (not under /households/:id) in router.ts

export const settlementTransactionRouter = Router({ mergeParams: true })
settlementTransactionRouter.use(requireAuth)

settlementTransactionRouter.patch('/:transactionId', async (req, res, next) => {
  try {
    const { settlementId, transactionId } = req.params as { settlementId: string; transactionId: string }
    const userId = req.user!.userId

    const body = z.object({ paid: z.literal(true) }).parse(req.body)

    // Get settlement + verify membership
    const settlementResult = await db.query<{ household_id: string | null; status: string }>(
      'SELECT household_id, status FROM settlements WHERE id = $1',
      [settlementId]
    )
    const settlement = settlementResult.rows[0]
    if (!settlement) throw new AppError(404, 'NOT_FOUND', 'Settlement not found')
    if (settlement.status !== 'open') throw new AppError(409, 'ALREADY_CLOSED', 'Settlement is already closed')

    if (settlement.household_id) {
      const memberCheck = await db.query(
        'SELECT id FROM household_members WHERE household_id = $1 AND user_id = $2',
        [settlement.household_id, userId]
      )
      if (memberCheck.rows.length === 0) throw new AppError(403, 'FORBIDDEN', 'Not a member')
    }

    const now = new Date()
    await db.query(
      'UPDATE settlement_transactions SET paid_at = $1 WHERE id = $2 AND settlement_id = $3',
      [now, transactionId, settlementId]
    )

    // Check if ALL transactions are now paid → auto-close settlement
    const unpaidResult = await db.query(
      'SELECT COUNT(*) as count FROM settlement_transactions WHERE settlement_id = $1 AND paid_at IS NULL',
      [settlementId]
    )
    const unpaidCount = parseInt((unpaidResult.rows[0] as { count: string }).count, 10)

    if (unpaidCount === 0) {
      await db.transaction(async (client) => {
        await client.query(
          "UPDATE settlements SET status = 'completed' WHERE id = $1",
          [settlementId]
        )
        // Mark all expenses in this period as settled
        if (settlement.household_id) {
          const s = await client.query<{ period_year: number; period_month: number }>(
            'SELECT period_year, period_month FROM settlements WHERE id = $1',
            [settlementId]
          )
          const { period_year, period_month } = s.rows[0]!
          await client.query(
            `UPDATE expenses SET status = 'settled'
             WHERE household_id = $1
               AND status = 'confirmed'
               AND EXTRACT(YEAR FROM expense_date) = $2
               AND EXTRACT(MONTH FROM expense_date) = $3`,
            [settlement.household_id, period_year, period_month]
          )
        }
      })

      if (settlement.household_id) {
        broadcast(settlement.household_id, { type: 'settlement.completed', settlementId })
      }
    }

    res.json({ id: transactionId, paidAt: now })
  } catch (err) {
    next(err)
  }
})

export { router as settlementsRouter }
