import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'
import { db } from '../../db/client.js'
import { streamImage } from '../streamImage.js'
import { tagLineItems } from '../../services/tagMatcher.js'
import { receiptUpload } from '../receiptUpload.js'
import { receiptParseLimiter } from '../middleware/rateLimit.js'
import { intakeReceipt } from '../../services/receiptIntake.js'
import { createDraftFromIntake } from '../../services/draftExpense.js'
import { getFullExpense, recomputeExpenseTotal, UpdateExpenseSchema, buildExpenseUpdate } from '../../services/expenseView.js'

const router = Router({ mergeParams: true })
router.use(requireAuth)

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/** Draft edit routes only operate on a pending_review expense in this household. */
async function requireDraftExpense(householdId: string, expenseId: string): Promise<void> {
  const expCheck = await db.query<{ status: string }>(
    'SELECT status FROM expenses WHERE id = $1 AND household_id = $2',
    [expenseId, householdId]
  )
  const expense = expCheck.rows[0]
  if (!expense) throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found')
  if (expense.status !== 'pending_review') {
    throw new AppError(409, 'INVALID_STATUS', 'Only a draft can be edited')
  }
}

// ─── POST /households/:householdId/expenses ───────────────────────────────────

const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceOre: z.number().int('Unit price must be an integer (øre)'),
  tagId: z.string().uuid().optional(),
  isPersonal: z.boolean().default(false),
  categoryId: z.string().uuid().optional(),
})

const CreateExpenseSchema = z.object({
  receiptImageKey: z.string().optional(),
  store: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  purchasedBy: z.string().uuid(),
  cardLastFour: z.string().regex(/^\d{4}$/).optional(),
  lineItems: z.array(LineItemSchema).min(1),
})

router.post('/', async (req, res, next) => {
  try {
    const { householdId } = req.params as { householdId: string }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)

    const body = CreateExpenseSchema.parse(req.body)

    // Validate all amounts are integers (should already be caught by zod, extra check)
    for (const item of body.lineItems) {
      if (!Number.isInteger(item.unitPriceOre)) {
        throw new AppError(400, 'NON_INTEGER_AMOUNT', `unitPriceOre must be an integer (received ${item.unitPriceOre})`)
      }
    }

    // purchasedBy must be a member of this household — otherwise an expense could be
    // attributed to a user from another household, corrupting settlement balances.
    const purchaserCheck = await db.query(
      'SELECT id FROM household_members WHERE household_id = $1 AND user_id = $2',
      [householdId, body.purchasedBy]
    )
    if (purchaserCheck.rows.length === 0) {
      throw new AppError(400, 'INVALID_PURCHASER', 'purchasedBy must be a member of this household')
    }

    // Fetch household personal keywords for auto-tagging
    const keywordsResult = await db.query<{ keyword: string }>(
      'SELECT keyword FROM personal_keywords WHERE household_id = $1',
      [householdId]
    )
    const keywords = keywordsResult.rows.map((r) => r.keyword)

    // Auto-tag with personal keywords (user can override via lineItems[].isPersonal)
    const taggedItems = tagLineItems(
      body.lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPriceOre: item.unitPriceOre,
        confidenceLow: false,
      })),
      keywords
    )

    // Resolve final isPersonal per line (user choice OR auto-tag) before computing the
    // household-billable total. total_amount_ore must exclude personal items — it feeds
    // settlement.householdAmountOre, and the edit/PATCH path already excludes them.
    const resolvedLineItems = body.lineItems.map((item, i) => ({
      ...item,
      isPersonal: item.isPersonal || (taggedItems[i]?.isPersonal ?? false),
    }))

    const totalAmountOre = resolvedLineItems.reduce(
      (sum, item) => (item.isPersonal ? sum : sum + item.unitPriceOre * item.quantity),
      0
    )

    const expense = await db.transaction(async (client) => {
      const expResult = await client.query<{ id: string }>(
        `INSERT INTO expenses
           (household_id, purchased_by, receipt_image_key, store, expense_date, total_amount_ore, card_last_four, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_review')
         RETURNING id`,
        [
          householdId,
          body.purchasedBy,
          body.receiptImageKey ?? null,
          body.store ?? null,
          body.date ?? null,
          totalAmountOre,
          body.cardLastFour ?? null,
        ]
      )
      const expenseId = expResult.rows[0]!.id

      for (const item of resolvedLineItems) {
        await client.query(
          `INSERT INTO line_items
             (expense_id, description, quantity, unit_price_ore, tag_id, is_personal, category_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            expenseId,
            item.description,
            item.quantity,
            item.unitPriceOre,
            item.tagId ?? null,
            item.isPersonal,
            item.categoryId ?? null,
          ]
        )
      }

      return expenseId
    })

    const fullExpense = await getFullExpense(expense, { householdId })
    res.status(201).json(fullExpense)
  } catch (err) {
    next(err)
  }
})

// ─── GET /households/:householdId/expenses ────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { householdId } = req.params as { householdId: string }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)

    const { month, status } = req.query as { month?: string; status?: string }

    let query = `SELECT e.id, e.purchased_by, e.store, e.expense_date, e.total_amount_ore,
                        e.card_last_four, e.status, e.created_at,
                        u.name as purchaser_name
                 FROM expenses e JOIN users u ON u.id = e.purchased_by
                 WHERE e.household_id = $1`
    const params: unknown[] = [householdId]
    let i = 2

    if (month) {
      query += ` AND TO_CHAR(e.expense_date, 'YYYY-MM') = $${i++}`
      params.push(month)
    }
    if (status) {
      query += ` AND e.status = $${i++}`
      params.push(status)
    }

    query += ' ORDER BY e.expense_date DESC, e.created_at DESC'

    const result = await db.query<{
      id: string
      purchased_by: string
      store: string | null
      expense_date: string | null
      total_amount_ore: number
      card_last_four: string | null
      status: string
      created_at: Date
      purchaser_name: string
    }>(query, params)
    res.json({
      expenses: result.rows.map((r) => ({
        id: r.id,
        purchasedBy: r.purchased_by,
        purchaserName: r.purchaser_name,
        store: r.store,
        date: r.expense_date,
        totalAmountOre: Number(r.total_amount_ore),
        cardLastFour: r.card_last_four,
        status: r.status,
        createdAt: r.created_at,
      })),
    })
  } catch (err) {
    next(err)
  }
})

// ─── GET /households/:householdId/expenses/:expenseId ────────────────────────

router.get('/:expenseId', async (req, res, next) => {
  try {
    const { householdId, expenseId } = req.params as { householdId: string; expenseId: string }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)

    const expense = await getFullExpense(expenseId, { householdId })
    if (!expense) throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found')

    res.json(expense)
  } catch (err) {
    next(err)
  }
})

// ─── GET /households/:householdId/expenses/:expenseId/receipt ────────────────

router.get('/:expenseId/receipt', async (req, res, next) => {
  try {
    const { householdId, expenseId } = req.params as { householdId: string; expenseId: string }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)

    const result = await db.query<{ receipt_image_key: string | null }>(
      'SELECT receipt_image_key FROM expenses WHERE id = $1 AND household_id = $2',
      [expenseId, householdId]
    )
    const key = result.rows[0]?.receipt_image_key
    if (!key) throw new AppError(404, 'RECEIPT_NOT_FOUND', 'This expense has no receipt')

    await streamImage(res, key)
  } catch (err) {
    next(err)
  }
})

// ─── POST /households/:householdId/expenses/:expenseId/confirm ───────────────

router.post('/:expenseId/confirm', async (req, res, next) => {
  try {
    const { householdId, expenseId } = req.params as { householdId: string; expenseId: string }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)

    const result = await db.query<{ id: string; status: string; purchased_by: string }>(
      'SELECT id, status, purchased_by FROM expenses WHERE id = $1 AND household_id = $2',
      [expenseId, householdId]
    )
    const expense = result.rows[0]
    if (!expense) throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found')
    if (expense.status !== 'pending_review') {
      throw new AppError(409, 'INVALID_STATUS', 'Only pending_review expenses can be confirmed')
    }

    const lineItemCount = await db.query('SELECT 1 FROM line_items WHERE expense_id = $1 LIMIT 1', [expenseId])
    if (lineItemCount.rows.length === 0) {
      throw new AppError(409, 'EMPTY_EXPENSE', 'A draft needs at least one line item before it can be confirmed')
    }

    await db.query(
      "UPDATE expenses SET status = 'confirmed', updated_at = now() WHERE id = $1",
      [expenseId]
    )

    const updated = await getFullExpense(expenseId, { householdId })
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

// ─── PATCH /households/:householdId/expenses/:expenseId/line-items/:lineItemId ─

const UpdateLineItemSchema = z.object({
  unitPriceOre: z.number().int().min(0).optional(),
  quantity: z.number().int().min(1).optional(),
  description: z.string().min(1).optional(),
  isPersonal: z.boolean().optional(),
  categoryId: z.string().uuid().nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' })

const lineItemRouter = Router({ mergeParams: true })
lineItemRouter.use(requireAuth)

lineItemRouter.patch('/', async (req, res, next) => {
  try {
    const { householdId, expenseId, lineItemId } = req.params as {
      householdId: string; expenseId: string; lineItemId: string
    }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)

    // Verify expense belongs to household
    const expCheck = await db.query(
      'SELECT id FROM expenses WHERE id = $1 AND household_id = $2',
      [expenseId, householdId]
    )
    if (expCheck.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Expense not found')

    // Verify line item belongs to expense
    const liCheck = await db.query(
      'SELECT id FROM line_items WHERE id = $1 AND expense_id = $2',
      [lineItemId, expenseId]
    )
    if (liCheck.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Line item not found')

    const body = UpdateLineItemSchema.parse(req.body)

    // Build dynamic UPDATE
    const sets: string[] = []
    const params: unknown[] = []
    let i = 1
    if (body.unitPriceOre !== undefined) { sets.push(`unit_price_ore = $${i++}`); params.push(body.unitPriceOre) }
    if (body.quantity !== undefined) { sets.push(`quantity = $${i++}`); params.push(body.quantity) }
    if (body.description !== undefined) { sets.push(`description = $${i++}`); params.push(body.description) }
    if (body.isPersonal !== undefined) { sets.push(`is_personal = $${i++}`); params.push(body.isPersonal) }
    if (body.categoryId !== undefined) { sets.push(`category_id = $${i++}`); params.push(body.categoryId) }
    params.push(lineItemId)

    await db.query(`UPDATE line_items SET ${sets.join(', ')} WHERE id = $${i}`, params)
    const newTotalAmountOre = await recomputeExpenseTotal(expenseId)

    // Return updated line item
    const updated = await db.query<{
      id: string; description: string; quantity: number; unit_price_ore: number;
      tag_id: string | null; is_personal: boolean; category_id: string | null; category_name: string | null
    }>(
      `SELECT li.id, li.description, li.quantity, li.unit_price_ore, li.tag_id, li.is_personal,
              li.category_id, c.name as category_name
       FROM line_items li LEFT JOIN categories c ON c.id = li.category_id
       WHERE li.id = $1`,
      [lineItemId]
    )
    const li = updated.rows[0]!
    res.json({
      id: li.id,
      description: li.description,
      quantity: li.quantity,
      unitPriceOre: li.unit_price_ore,
      tagId: li.tag_id,
      isPersonal: li.is_personal,
      categoryId: li.category_id,
      categoryName: li.category_name,
      newTotalAmountOre,
    })
  } catch (err) {
    next(err)
  }
})

lineItemRouter.delete('/', async (req, res, next) => {
  try {
    const { householdId, expenseId, lineItemId } = req.params as {
      householdId: string; expenseId: string; lineItemId: string
    }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)
    await requireDraftExpense(householdId, expenseId)

    const liCheck = await db.query(
      'SELECT id FROM line_items WHERE id = $1 AND expense_id = $2',
      [lineItemId, expenseId]
    )
    if (liCheck.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Line item not found')

    await db.query('DELETE FROM line_items WHERE id = $1', [lineItemId])
    await recomputeExpenseTotal(expenseId)

    const updated = await getFullExpense(expenseId, { householdId })
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

export { lineItemRouter }

// ─── POST /households/:householdId/expenses/from-receipt ─────────────────────
// One call sanitises, stores, parses, matches the card, and categorises an
// uploaded receipt, then creates a pending_review draft with zero or more
// line items — idempotent per client-generated captureId (SC-009).

const FromReceiptSchema = z.object({
  captureId: z.string().uuid('captureId must be a UUID'),
})

router.post('/from-receipt', receiptParseLimiter, receiptUpload.single('receipt'), async (req, res, next) => {
  try {
    const { householdId } = req.params as { householdId: string }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)

    if (!req.file) throw new AppError(400, 'NO_FILE', 'No receipt file uploaded')
    const { captureId } = FromReceiptSchema.parse(req.body)

    const intake = await intakeReceipt(householdId, `receipts/${householdId}`, req.file.buffer)
    const { expenseId, created } = await createDraftFromIntake({ householdId }, householdId, userId, captureId, intake)

    const fullExpense = await getFullExpense(expenseId, { householdId })
    res.status(created ? 201 : 200).json(fullExpense)
  } catch (err) {
    next(err)
  }
})

// ─── PATCH /households/:householdId/expenses/:expenseId ──────────────────────
// Draft-only field edits (store, date, purchaser, card). Line-item mutations
// have their own routes below.

router.patch('/:expenseId', async (req, res, next) => {
  try {
    const { householdId, expenseId } = req.params as { householdId: string; expenseId: string }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)
    await requireDraftExpense(householdId, expenseId)

    const body = UpdateExpenseSchema.parse(req.body)

    if (body.purchasedBy !== undefined) {
      const purchaserCheck = await db.query(
        'SELECT id FROM household_members WHERE household_id = $1 AND user_id = $2',
        [householdId, body.purchasedBy]
      )
      if (purchaserCheck.rows.length === 0) {
        throw new AppError(400, 'INVALID_PURCHASER', 'purchasedBy must be a member of this household')
      }
    }

    const { sets, params } = buildExpenseUpdate(body)
    params.push(expenseId)

    await db.query(`UPDATE expenses SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params)

    const updated = await getFullExpense(expenseId, { householdId })
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

// ─── POST /households/:householdId/expenses/:expenseId/line-items ────────────

router.post('/:expenseId/line-items', async (req, res, next) => {
  try {
    const { householdId, expenseId } = req.params as { householdId: string; expenseId: string }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)
    await requireDraftExpense(householdId, expenseId)

    const body = LineItemSchema.parse(req.body)

    await db.query(
      `INSERT INTO line_items (expense_id, description, quantity, unit_price_ore, tag_id, is_personal, category_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [expenseId, body.description, body.quantity, body.unitPriceOre, body.tagId ?? null, body.isPersonal, body.categoryId ?? null]
    )
    await recomputeExpenseTotal(expenseId)

    const updated = await getFullExpense(expenseId, { householdId })
    res.status(201).json(updated)
  } catch (err) {
    next(err)
  }
})

export { router as expensesRouter }
