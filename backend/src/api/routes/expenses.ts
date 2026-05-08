import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'
import { db } from '../../db/client.js'
import { getReceiptUrl } from '../../storage/minio.js'
import { tagLineItems } from '../../services/tagMatcher.js'
import { broadcast } from '../../ws/server.js'

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

// ─── POST /households/:householdId/expenses ───────────────────────────────────

const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
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

    const totalAmountOre = body.lineItems.reduce(
      (sum, item) => sum + item.unitPriceOre * item.quantity,
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

      for (let i = 0; i < body.lineItems.length; i++) {
        const item = body.lineItems[i]!
        const autoPersonal = taggedItems[i]?.isPersonal ?? false
        const isPersonal = item.isPersonal || autoPersonal

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
            isPersonal,
            item.categoryId ?? null,
          ]
        )
      }

      return expenseId
    })

    const fullExpense = await getFullExpense(expense, userId)
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

    const expense = await getFullExpense(expenseId, userId)
    if (!expense) throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found')

    res.json(expense)
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

    await db.query(
      "UPDATE expenses SET status = 'confirmed', updated_at = now() WHERE id = $1",
      [expenseId]
    )

    broadcast(householdId, {
      type: 'expense.confirmed',
      householdId,
      expenseId,
      confirmedBy: userId,
    })

    const updated = await getFullExpense(expenseId, userId)
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
}).refine((d) => d.unitPriceOre !== undefined || d.quantity !== undefined || d.description !== undefined, {
  message: 'At least one field must be provided',
})

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
    params.push(lineItemId)

    await db.query(`UPDATE line_items SET ${sets.join(', ')} WHERE id = $${i}`, params)

    // Recalculate expense total from non-personal line items
    const totalResult = await db.query<{ total: string }>(
      `SELECT COALESCE(SUM(unit_price_ore * quantity), 0)::bigint as total
       FROM line_items WHERE expense_id = $1 AND is_personal = false`,
      [expenseId]
    )
    await db.query(
      'UPDATE expenses SET total_amount_ore = $1 WHERE id = $2',
      [parseInt(totalResult.rows[0]!.total, 10), expenseId]
    )

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
      newTotalAmountOre: parseInt(totalResult.rows[0]!.total, 10),
    })
  } catch (err) {
    next(err)
  }
})

export { lineItemRouter }

// ─── Helper: fetch full expense with line items and signed receipt URL ────────

async function getFullExpense(expenseId: string, _userId: string) {
  const expResult = await db.query<{
    id: string
    household_id: string
    purchased_by: string
    purchaser_name: string
    receipt_image_key: string | null
    store: string | null
    expense_date: string | null
    total_amount_ore: number
    card_last_four: string | null
    status: string
    created_at: Date
  }>(
    `SELECT e.*, u.name as purchaser_name
     FROM expenses e JOIN users u ON u.id = e.purchased_by
     WHERE e.id = $1`,
    [expenseId]
  )
  const expense = expResult.rows[0]
  if (!expense) return null

  const itemsResult = await db.query<{
    id: string
    description: string
    quantity: number
    unit_price_ore: number
    tag_id: string | null
    is_personal: boolean
    category_id: string | null
    category_name: string | null
  }>(
    `SELECT li.id, li.description, li.quantity, li.unit_price_ore, li.tag_id, li.is_personal,
            li.category_id, c.name as category_name
     FROM line_items li
     LEFT JOIN categories c ON c.id = li.category_id
     WHERE li.expense_id = $1 ORDER BY li.id`,
    [expenseId]
  )

  let receiptImageUrl: string | null = null
  if (expense.receipt_image_key) {
    try {
      receiptImageUrl = await getReceiptUrl(expense.receipt_image_key)
    } catch {
      // signed URL generation failure is non-fatal
    }
  }

  return {
    id: expense.id,
    householdId: expense.household_id,
    purchasedBy: expense.purchased_by,
    purchaserName: expense.purchaser_name,
    receiptImageKey: expense.receipt_image_key,
    receiptImageUrl,
    store: expense.store,
    date: expense.expense_date,
    totalAmountOre: expense.total_amount_ore,
    cardLastFour: expense.card_last_four,
    status: expense.status,
    createdAt: expense.created_at,
    lineItems: itemsResult.rows.map((li) => ({
      id: li.id,
      description: li.description,
      quantity: li.quantity,
      unitPriceOre: li.unit_price_ore,
      tagId: li.tag_id,
      isPersonal: li.is_personal,
      categoryId: li.category_id,
      categoryName: li.category_name,
    })),
  }
}

export { router as expensesRouter }
