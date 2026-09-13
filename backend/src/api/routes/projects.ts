import { Router } from 'express'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'
import { streamImage } from '../streamImage.js'
import { calculateSettlement } from '@expense-tracker/shared'
import { receiptUpload } from '../receiptUpload.js'
import { receiptParseLimiter } from '../middleware/rateLimit.js'
import { intakeReceipt } from '../../services/receiptIntake.js'
import { createDraftFromIntake } from '../../services/draftExpense.js'
import { getFullExpense, recomputeExpenseTotal, UpdateExpenseSchema, buildExpenseUpdate } from '../../services/expenseView.js'

const router = Router({ mergeParams: true })
router.use(requireAuth)

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AllocationShareSchema = z.object({
  userId: z.string().uuid(),
  shareBp: z.number().int().positive(),
})

async function requireProjectAdmin(projectId: string, userId: string) {
  const result = await db.query(
    "SELECT id FROM project_members WHERE project_id = $1 AND user_id = $2 AND role = 'admin'",
    [projectId, userId]
  )
  if (result.rows.length === 0) {
    throw new AppError(403, 'ADMIN_ONLY', 'Only the project admin can perform this action')
  }
}

async function requireProjectMember(projectId: string, userId: string) {
  const result = await db.query(
    'SELECT id FROM project_members WHERE project_id = $1 AND user_id = $2',
    [projectId, userId]
  )
  if (result.rows.length === 0) throw new AppError(403, 'FORBIDDEN', 'Not a project member')
}

async function buildProjectResponse(projectId: string) {
  const [projectResult, membersResult, allocationResult] = await Promise.all([
    db.query<{ id: string; household_id: string; name: string; description: string | null; status: string; current_allocation_key_id: string | null }>(
      'SELECT * FROM projects WHERE id = $1',
      [projectId]
    ),
    db.query<{ user_id: string; name: string; role: string }>(
      `SELECT pm.user_id, u.name, pm.role FROM project_members pm
       JOIN users u ON u.id = pm.user_id WHERE pm.project_id = $1`,
      [projectId]
    ),
    db.query<{ user_id: string; name: string; share_bp: number }>(
      `SELECT aks.user_id, u.name, aks.share_bp
       FROM allocation_key_shares aks
       JOIN users u ON u.id = aks.user_id
       JOIN projects p ON p.current_allocation_key_id = aks.allocation_key_id
       WHERE p.id = $1`,
      [projectId]
    ),
  ])
  const p = projectResult.rows[0]!
  return {
    id: p.id,
    householdId: p.household_id,
    name: p.name,
    description: p.description,
    status: p.status,
    members: membersResult.rows.map((m) => ({ userId: m.user_id, name: m.name, role: m.role })),
    allocationKey: allocationResult.rows.map((s) => ({ userId: s.user_id, name: s.name, shareBp: s.share_bp })),
  }
}

// ─── POST /households/:householdId/projects ───────────────────────────────────

const CreateProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  memberIds: z.array(z.string().uuid()).min(1),
  allocationKey: z.array(AllocationShareSchema).min(1),
})

router.post('/', async (req, res, next) => {
  try {
    const { householdId } = req.params as { householdId: string }
    const userId = req.user!.userId

    // Must be a household member
    const memberCheck = await db.query(
      'SELECT id FROM household_members WHERE household_id = $1 AND user_id = $2',
      [householdId, userId]
    )
    if (memberCheck.rows.length === 0) throw new AppError(403, 'FORBIDDEN', 'Not a household member')

    const body = CreateProjectSchema.parse(req.body)
    const totalBp = body.allocationKey.reduce((sum, s) => sum + s.shareBp, 0)
    if (totalBp !== 10_000) {
      throw new AppError(400, 'ALLOCATION_KEY_MUST_SUM_TO_10000', 'Allocation key must sum to 10000 basis points')
    }

    // Every project member must belong to this household — otherwise an outsider
    // could be pulled into the project's settlement math.
    const uniqueMemberIds = [...new Set(body.memberIds)]
    const memberRows = await db.query(
      'SELECT user_id FROM household_members WHERE household_id = $1 AND user_id = ANY($2::uuid[])',
      [householdId, uniqueMemberIds]
    )
    if (memberRows.rows.length !== uniqueMemberIds.length) {
      throw new AppError(400, 'INVALID_MEMBERS', 'All project members must belong to this household')
    }

    const projectId = await db.transaction(async (client) => {
      const pResult = await client.query<{ id: string }>(
        "INSERT INTO projects (household_id, name, description, status) VALUES ($1, $2, $3, 'active') RETURNING id",
        [householdId, body.name, body.description ?? null]
      )
      const pid = pResult.rows[0]!.id

      // Allocation key
      const keyResult = await client.query<{ id: string }>(
        'INSERT INTO allocation_keys (household_id) VALUES ($1) RETURNING id',
        [householdId]
      )
      const keyId = keyResult.rows[0]!.id
      for (const share of body.allocationKey) {
        await client.query(
          'INSERT INTO allocation_key_shares (allocation_key_id, user_id, share_bp) VALUES ($1, $2, $3)',
          [keyId, share.userId, share.shareBp]
        )
      }
      await client.query('UPDATE projects SET current_allocation_key_id = $1 WHERE id = $2', [keyId, pid])

      // Members — creator is admin, others are members
      await client.query(
        "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'admin')",
        [pid, userId]
      )
      for (const memberId of body.memberIds) {
        if (memberId !== userId) {
          await client.query(
            "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
            [pid, memberId]
          )
        }
      }

      return pid
    })

    const project = await buildProjectResponse(projectId)
    res.status(201).json(project)
  } catch (err) {
    next(err)
  }
})

// ─── GET /households/:householdId/projects ────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { householdId } = req.params as { householdId: string }
    const userId = req.user!.userId

    const memberCheck = await db.query(
      'SELECT id FROM household_members WHERE household_id = $1 AND user_id = $2',
      [householdId, userId]
    )
    if (memberCheck.rows.length === 0) throw new AppError(403, 'FORBIDDEN', 'Not a household member')

    const result = await db.query<{ id: string; name: string; status: string; member_count: string }>(
      `SELECT p.id, p.name, p.status, COUNT(pm.user_id) as member_count
       FROM projects p LEFT JOIN project_members pm ON pm.project_id = p.id
       WHERE p.household_id = $1
       GROUP BY p.id ORDER BY p.created_at DESC`,
      [householdId]
    )
    res.json({ projects: result.rows.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      memberCount: parseInt(p.member_count, 10),
    })) })
  } catch (err) {
    next(err)
  }
})

// ─── GET /projects/:projectId ─────────────────────────────────────────────────

export const projectDetailRouter = Router({ mergeParams: true })
projectDetailRouter.use(requireAuth)

projectDetailRouter.get('/', async (req, res, next) => {
  try {
    const { projectId } = req.params as { projectId: string }
    const userId = req.user!.userId
    await requireProjectMember(projectId, userId)
    const project = await buildProjectResponse(projectId)
    res.json(project)
  } catch (err) {
    next(err)
  }
})

// ─── POST /projects/:projectId/expenses ──────────────────────────────────────
// ─── GET /projects/:projectId/expenses ───────────────────────────────────────

const ProjectLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceOre: z.number().int(),
  isPersonal: z.boolean().default(false),
  categoryId: z.string().uuid().optional(),
})

async function requirePurchaserIsProjectMember(projectId: string, purchasedBy: string) {
  const purchaserCheck = await db.query(
    'SELECT id FROM project_members WHERE project_id = $1 AND user_id = $2',
    [projectId, purchasedBy]
  )
  if (purchaserCheck.rows.length === 0) {
    throw new AppError(400, 'INVALID_PURCHASER', 'purchasedBy must be a member of this project')
  }
}

async function getProjectHouseholdId(projectId: string): Promise<string> {
  const result = await db.query<{ household_id: string }>('SELECT household_id FROM projects WHERE id = $1', [projectId])
  const row = result.rows[0]
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Project not found')
  return row.household_id
}

projectDetailRouter.post('/expenses', async (req, res, next) => {
  try {
    const { projectId } = req.params as { projectId: string }
    const userId = req.user!.userId
    await requireProjectMember(projectId, userId)

    const body = z.object({
      store: z.string().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      purchasedBy: z.string().uuid(),
      receiptImageKey: z.string().optional(),
      cardLastFour: z.string().optional(),
      lineItems: z.array(ProjectLineItemSchema).min(1),
    }).parse(req.body)

    // purchasedBy must be a project member — otherwise the expense would credit
    // someone outside the project when the settlement is calculated.
    await requirePurchaserIsProjectMember(projectId, body.purchasedBy)

    // Exclude personal items — total_amount_ore is the project-billable amount
    const totalAmountOre = body.lineItems.reduce(
      (sum, li) => (li.isPersonal ? sum : sum + li.unitPriceOre * li.quantity),
      0,
    )

    const expenseId = await db.transaction(async (client) => {
      const expResult = await client.query<{ id: string }>(
        `INSERT INTO expenses
           (project_id, purchased_by, store, expense_date, total_amount_ore, receipt_image_key, card_last_four, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed')
         RETURNING id`,
        [
          projectId,
          body.purchasedBy,
          body.store ?? null,
          body.date ?? null,
          totalAmountOre,
          body.receiptImageKey ?? null,
          body.cardLastFour ?? null,
        ]
      )
      const eid = expResult.rows[0]!.id
      for (const li of body.lineItems) {
        await client.query(
          'INSERT INTO line_items (expense_id, description, quantity, unit_price_ore, total_price_ore, is_personal, category_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [eid, li.description, li.quantity, li.unitPriceOre, li.unitPriceOre * li.quantity, li.isPersonal, li.categoryId ?? null]
        )
      }
      return eid
    })

    const fullExpense = await getFullExpense(expenseId, { projectId })
    res.status(201).json(fullExpense)
  } catch (err) {
    next(err)
  }
})

projectDetailRouter.get('/expenses', async (req, res, next) => {
  try {
    const { projectId } = req.params as { projectId: string }
    const userId = req.user!.userId
    await requireProjectMember(projectId, userId)

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
    }>(
      `SELECT e.id, e.purchased_by, e.store, e.expense_date, e.total_amount_ore,
              e.card_last_four, e.status, e.created_at, u.name as purchaser_name
       FROM expenses e JOIN users u ON u.id = e.purchased_by
       WHERE e.project_id = $1 ORDER BY e.expense_date DESC, e.created_at DESC`,
      [projectId]
    )
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

// ─── GET /projects/:projectId/expenses/:expenseId ────────────────────────────

projectDetailRouter.get('/expenses/:expenseId', async (req, res, next) => {
  try {
    const { projectId, expenseId } = req.params as { projectId: string; expenseId: string }
    const userId = req.user!.userId
    await requireProjectMember(projectId, userId)

    const expense = await getFullExpense(expenseId, { projectId })
    if (!expense) throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found')

    res.json(expense)
  } catch (err) {
    next(err)
  }
})

// ─── POST /projects/:projectId/expenses/from-receipt ─────────────────────────

const FromReceiptSchema = z.object({
  captureId: z.string().uuid('captureId must be a UUID'),
})

projectDetailRouter.post(
  '/expenses/from-receipt',
  receiptParseLimiter,
  receiptUpload.single('receipt'),
  async (req, res, next) => {
    try {
      const { projectId } = req.params as { projectId: string }
      const userId = req.user!.userId
      await requireProjectMember(projectId, userId)

      if (!req.file) throw new AppError(400, 'NO_FILE', 'No receipt file uploaded')
      const { captureId } = FromReceiptSchema.parse(req.body)

      const householdId = await getProjectHouseholdId(projectId)
      const intake = await intakeReceipt(householdId, `receipts/projects/${projectId}`, req.file.buffer)
      const { expenseId, created } = await createDraftFromIntake({ projectId }, householdId, userId, captureId, intake)

      const fullExpense = await getFullExpense(expenseId, { projectId })
      res.status(created ? 201 : 200).json(fullExpense)
    } catch (err) {
      next(err)
    }
  }
)

// ─── PATCH /projects/:projectId/expenses/:expenseId ──────────────────────────

projectDetailRouter.patch('/expenses/:expenseId', async (req, res, next) => {
  try {
    const { projectId, expenseId } = req.params as { projectId: string; expenseId: string }
    const userId = req.user!.userId
    await requireProjectMember(projectId, userId)
    await requireProjectDraftExpense(projectId, expenseId)

    const body = UpdateExpenseSchema.parse(req.body)
    if (body.purchasedBy !== undefined) {
      await requirePurchaserIsProjectMember(projectId, body.purchasedBy)
    }

    const { sets, params } = buildExpenseUpdate(body)
    params.push(expenseId)

    await db.query(`UPDATE expenses SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params)

    const updated = await getFullExpense(expenseId, { projectId })
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

// ─── Line items on a project draft ───────────────────────────────────────────

async function requireProjectDraftExpense(projectId: string, expenseId: string) {
  const expCheck = await db.query<{ status: string }>(
    'SELECT status FROM expenses WHERE id = $1 AND project_id = $2',
    [expenseId, projectId]
  )
  const expense = expCheck.rows[0]
  if (!expense) throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found')
  if (expense.status !== 'pending_review') {
    throw new AppError(409, 'INVALID_STATUS', 'Line items can only be changed on a draft')
  }
}

projectDetailRouter.post('/expenses/:expenseId/line-items', async (req, res, next) => {
  try {
    const { projectId, expenseId } = req.params as { projectId: string; expenseId: string }
    const userId = req.user!.userId
    await requireProjectMember(projectId, userId)
    await requireProjectDraftExpense(projectId, expenseId)

    const body = ProjectLineItemSchema.parse(req.body)

    await db.query(
      `INSERT INTO line_items (expense_id, description, quantity, unit_price_ore, total_price_ore, is_personal, category_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        expenseId,
        body.description,
        body.quantity,
        body.unitPriceOre,
        body.unitPriceOre * body.quantity,
        body.isPersonal,
        body.categoryId ?? null,
      ]
    )
    await recomputeExpenseTotal(expenseId)

    const updated = await getFullExpense(expenseId, { projectId })
    res.status(201).json(updated)
  } catch (err) {
    next(err)
  }
})

const UpdateProjectLineItemSchema = z.object({
  unitPriceOre: z.number().int().min(0).optional(),
  quantity: z.number().int().min(1).optional(),
  description: z.string().min(1).optional(),
  isPersonal: z.boolean().optional(),
  categoryId: z.string().uuid().nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' })

projectDetailRouter.patch('/expenses/:expenseId/line-items/:lineItemId', async (req, res, next) => {
  try {
    const { projectId, expenseId, lineItemId } = req.params as { projectId: string; expenseId: string; lineItemId: string }
    const userId = req.user!.userId
    await requireProjectMember(projectId, userId)
    await requireProjectDraftExpense(projectId, expenseId)

    const liCheck = await db.query('SELECT id FROM line_items WHERE id = $1 AND expense_id = $2', [lineItemId, expenseId])
    if (liCheck.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Line item not found')

    const body = UpdateProjectLineItemSchema.parse(req.body)

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
    await db.query('UPDATE line_items SET total_price_ore = unit_price_ore * quantity WHERE id = $1', [lineItemId])
    await recomputeExpenseTotal(expenseId)

    const updated = await getFullExpense(expenseId, { projectId })
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

projectDetailRouter.delete('/expenses/:expenseId/line-items/:lineItemId', async (req, res, next) => {
  try {
    const { projectId, expenseId, lineItemId } = req.params as { projectId: string; expenseId: string; lineItemId: string }
    const userId = req.user!.userId
    await requireProjectMember(projectId, userId)
    await requireProjectDraftExpense(projectId, expenseId)

    const liCheck = await db.query('SELECT id FROM line_items WHERE id = $1 AND expense_id = $2', [lineItemId, expenseId])
    if (liCheck.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Line item not found')

    await db.query('DELETE FROM line_items WHERE id = $1', [lineItemId])
    await recomputeExpenseTotal(expenseId)

    const updated = await getFullExpense(expenseId, { projectId })
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

// ─── POST /projects/:projectId/expenses/:expenseId/confirm ───────────────────

projectDetailRouter.post('/expenses/:expenseId/confirm', async (req, res, next) => {
  try {
    const { projectId, expenseId } = req.params as { projectId: string; expenseId: string }
    const userId = req.user!.userId
    await requireProjectMember(projectId, userId)

    const result = await db.query<{ status: string }>(
      'SELECT status FROM expenses WHERE id = $1 AND project_id = $2',
      [expenseId, projectId]
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

    await db.query("UPDATE expenses SET status = 'confirmed', updated_at = now() WHERE id = $1", [expenseId])

    const updated = await getFullExpense(expenseId, { projectId })
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

// ─── GET /projects/:projectId/expenses/:expenseId/receipt ────────────────────

projectDetailRouter.get('/expenses/:expenseId/receipt', async (req, res, next) => {
  try {
    const { projectId, expenseId } = req.params as { projectId: string; expenseId: string }
    const userId = req.user!.userId
    await requireProjectMember(projectId, userId)

    const result = await db.query<{ receipt_image_key: string | null }>(
      'SELECT receipt_image_key FROM expenses WHERE id = $1 AND project_id = $2',
      [expenseId, projectId]
    )
    const key = result.rows[0]?.receipt_image_key
    if (!key) throw new AppError(404, 'RECEIPT_NOT_FOUND', 'This expense has no receipt')

    await streamImage(res, key)
  } catch (err) {
    next(err)
  }
})

// ─── POST /projects/:projectId/finish ─────────────────────────────────────────

projectDetailRouter.post('/finish', async (req, res, next) => {
  try {
    const { projectId } = req.params as { projectId: string }
    const userId = req.user!.userId
    await requireProjectAdmin(projectId, userId)

    const projectResult = await db.query<{
      id: string; household_id: string; name: string; status: string; current_allocation_key_id: string | null
    }>('SELECT * FROM projects WHERE id = $1', [projectId])
    const project = projectResult.rows[0]
    if (!project) throw new AppError(404, 'NOT_FOUND', 'Project not found')
    if (project.status !== 'active') throw new AppError(409, 'INVALID_STATUS', 'Project is not active')
    if (!project.current_allocation_key_id) {
      throw new AppError(400, 'NO_ALLOCATION_KEY', 'Project has no allocation key')
    }

    // All confirmed expenses for this project
    const expensesResult = await db.query<{ id: string; total_amount_ore: number; purchased_by: string }>(
      "SELECT id, total_amount_ore, purchased_by FROM expenses WHERE project_id = $1 AND status = 'confirmed'",
      [projectId]
    )
    const sharesResult = await db.query<{ user_id: string; share_bp: number; role: string }>(
      `SELECT aks.user_id, aks.share_bp, pm.role
       FROM allocation_key_shares aks
       JOIN project_members pm
         ON pm.user_id = aks.user_id AND pm.project_id = $2
       WHERE aks.allocation_key_id = $1`,
      [project.current_allocation_key_id, projectId]
    )

    const { balances, transactions } = calculateSettlement(
      expensesResult.rows.map((e) => ({
        purchasedByUserId: e.purchased_by,
        householdAmountOre: Number(e.total_amount_ore),
      })),
      sharesResult.rows.map((s) => ({
        userId: s.user_id,
        shareBp: s.share_bp,
        isAdmin: s.role === 'admin',
      }))
    )

    const settlementId = await db.transaction(async (client) => {
      await client.query("UPDATE projects SET status = 'settling' WHERE id = $1", [projectId])

      const sResult = await client.query<{ id: string }>(
        `INSERT INTO settlements (project_id, status, allocation_key_snapshot_id, triggered_by_user_id)
         VALUES ($1, 'open', $2, $3) RETURNING id`,
        [projectId, project.current_allocation_key_id, userId]
      )
      const sid = sResult.rows[0]!.id

      for (const b of balances) {
        await client.query(
          'INSERT INTO settlement_balances (settlement_id, user_id, balance_ore) VALUES ($1,$2,$3)',
          [sid, b.userId, b.amountOre]
        )
      }
      for (const t of transactions) {
        await client.query(
          'INSERT INTO settlement_transactions (settlement_id, from_user_id, to_user_id, amount_ore) VALUES ($1,$2,$3,$4)',
          [sid, t.fromUserId, t.toUserId, t.amountOre]
        )
      }
      return sid
    })

    const sResult = await db.query('SELECT * FROM settlements WHERE id = $1', [settlementId])
    res.json(sResult.rows[0])
  } catch (err) {
    next(err)
  }
})

export { router as projectsRouter }
