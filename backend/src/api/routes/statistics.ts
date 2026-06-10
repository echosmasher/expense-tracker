import { Router } from 'express'
import { db } from '../../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'

const router = Router({ mergeParams: true })
router.use(requireAuth)

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

// ─── GET /households/:householdId/statistics ──────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { householdId } = req.params as { householdId: string }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)

    const { month, includePersonal } = req.query as { month?: string; includePersonal?: string }
    const targetMonth = month ?? new Date().toISOString().slice(0, 7)
    const [year, mon] = targetMonth.split('-').map(Number)
    const showPersonal = includePersonal === 'true'

    // Build personal filter: if not includePersonal, exclude personal line items
    // except those purchased by the requesting user (who sees their own).
    // userId is parameterized (never interpolated) to keep the query injection-free.
    const baseParams: unknown[] = [householdId, year, mon]
    let personalFilter = ''
    if (!showPersonal) {
      baseParams.push(userId)
      personalFilter = `AND (li.is_personal = false OR (li.is_personal = true AND e.purchased_by = $${baseParams.length}))`
    }

    // Total by tag (household tag) for the month
    const byTagResult = await db.query<{ tag_id: string; tag_name: string; total_ore: string }>(
      `SELECT li.tag_id, t.name as tag_name, SUM(li.unit_price_ore * li.quantity)::bigint as total_ore
       FROM line_items li
       JOIN expenses e ON e.id = li.expense_id
       LEFT JOIN tags t ON t.id = li.tag_id
       WHERE e.household_id = $1
         AND e.status IN ('confirmed', 'settled')
         AND e.project_id IS NULL
         AND EXTRACT(YEAR FROM e.expense_date) = $2
         AND EXTRACT(MONTH FROM e.expense_date) = $3
         ${personalFilter}
       GROUP BY li.tag_id, t.name
       ORDER BY total_ore DESC`,
      baseParams
    )

    // Total by member
    const byMemberResult = await db.query<{ user_id: string; name: string; total_ore: string }>(
      `SELECT e.purchased_by as user_id, u.name, SUM(e.total_amount_ore)::bigint as total_ore
       FROM expenses e JOIN users u ON u.id = e.purchased_by
       WHERE e.household_id = $1
         AND e.status IN ('confirmed', 'settled')
         AND e.project_id IS NULL
         AND EXTRACT(YEAR FROM e.expense_date) = $2
         AND EXTRACT(MONTH FROM e.expense_date) = $3
       GROUP BY e.purchased_by, u.name ORDER BY total_ore DESC`,
      [householdId, year, mon]
    )

    // Top 5 items by total spend (all months for context)
    const topItemsResult = await db.query<{ description: string; total_ore: string; count: string }>(
      `SELECT li.description, SUM(li.unit_price_ore * li.quantity)::bigint as total_ore, COUNT(*)::int as count
       FROM line_items li JOIN expenses e ON e.id = li.expense_id
       WHERE e.household_id = $1
         AND e.status IN ('confirmed', 'settled')
         AND e.project_id IS NULL
         AND EXTRACT(YEAR FROM e.expense_date) = $2
         AND EXTRACT(MONTH FROM e.expense_date) = $3
       GROUP BY li.description ORDER BY total_ore DESC LIMIT 5`,
      [householdId, year, mon]
    )

    // 6-month trend by tag
    const trendResult = await db.query<{ month: string; tag_id: string; tag_name: string; total_ore: string }>(
      `SELECT TO_CHAR(e.expense_date, 'YYYY-MM') as month,
              li.tag_id, t.name as tag_name,
              SUM(li.unit_price_ore * li.quantity)::bigint as total_ore
       FROM line_items li
       JOIN expenses e ON e.id = li.expense_id
       LEFT JOIN tags t ON t.id = li.tag_id
       WHERE e.household_id = $1
         AND e.status IN ('confirmed', 'settled')
         AND e.project_id IS NULL
         AND e.expense_date >= (DATE_TRUNC('month', NOW()) - INTERVAL '5 months')
       GROUP BY month, li.tag_id, t.name
       ORDER BY month, total_ore DESC`,
      [householdId]
    )

    // Pivot trend data: month → [{ tagId, tagName, totalOre }]
    const trendMap: Record<string, Array<{ tagId: string | null; tagName: string | null; totalOre: number }>> = {}
    for (const row of trendResult.rows) {
      if (!trendMap[row.month]) trendMap[row.month] = []
      trendMap[row.month]!.push({
        tagId: row.tag_id,
        tagName: row.tag_name,
        totalOre: parseInt(row.total_ore, 10),
      })
    }

    // Total by category for the month
    const byCategoryResult = await db.query<{
      category_id: string | null
      category_name: string | null
      total_ore: string
      item_count: string
    }>(
      `SELECT li.category_id, c.name as category_name,
              SUM(li.unit_price_ore * li.quantity)::bigint as total_ore,
              COUNT(*)::int as item_count
       FROM line_items li
       JOIN expenses e ON e.id = li.expense_id
       LEFT JOIN categories c ON c.id = li.category_id
       WHERE e.household_id = $1
         AND e.status IN ('confirmed', 'settled')
         AND e.project_id IS NULL
         AND EXTRACT(YEAR FROM e.expense_date) = $2
         AND EXTRACT(MONTH FROM e.expense_date) = $3
         ${personalFilter}
       GROUP BY li.category_id, c.name
       ORDER BY total_ore DESC`,
      baseParams
    )

    // 6-month category trends
    const categoryTrendResult = await db.query<{
      month: string
      category_id: string | null
      category_name: string | null
      total_ore: string
    }>(
      `SELECT TO_CHAR(e.expense_date, 'YYYY-MM') as month,
              li.category_id, c.name as category_name,
              SUM(li.unit_price_ore * li.quantity)::bigint as total_ore
       FROM line_items li
       JOIN expenses e ON e.id = li.expense_id
       LEFT JOIN categories c ON c.id = li.category_id
       WHERE e.household_id = $1
         AND e.status IN ('confirmed', 'settled')
         AND e.project_id IS NULL
         AND e.expense_date >= (DATE_TRUNC('month', NOW()) - INTERVAL '5 months')
       GROUP BY month, li.category_id, c.name
       ORDER BY month, total_ore DESC`,
      [householdId]
    )

    const categoryTrendMap: Record<string, Array<{ categoryId: string | null; categoryName: string; totalOre: number }>> = {}
    for (const row of categoryTrendResult.rows) {
      if (!categoryTrendMap[row.month]) categoryTrendMap[row.month] = []
      categoryTrendMap[row.month]!.push({
        categoryId: row.category_id,
        categoryName: row.category_name ?? 'Uncategorized',
        totalOre: parseInt(row.total_ore, 10),
      })
    }

    const totalOre = byTagResult.rows.reduce((sum, r) => sum + parseInt(r.total_ore, 10), 0)

    res.json({
      month: targetMonth,
      totalOre,
      byTag: byTagResult.rows.map((r) => ({
        tagId: r.tag_id,
        tagName: r.tag_name ?? 'Uncategorised',
        totalOre: parseInt(r.total_ore, 10),
      })),
      byMember: byMemberResult.rows.map((r) => ({
        userId: r.user_id,
        name: r.name,
        totalOre: parseInt(r.total_ore, 10),
      })),
      topItems: topItemsResult.rows.map((r) => ({
        description: r.description,
        totalOre: parseInt(r.total_ore, 10),
        count: parseInt(r.count, 10),
      })),
      trends: Object.entries(trendMap).map(([month, byTag]) => ({ month, byTag })),
      byCategory: byCategoryResult.rows.map((r) => ({
        categoryId: r.category_id,
        categoryName: r.category_name ?? 'Uncategorized',
        totalOre: parseInt(r.total_ore, 10),
        itemCount: parseInt(r.item_count, 10),
      })),
      categoryTrends: Object.entries(categoryTrendMap).map(([month, byCategory]) => ({ month, byCategory })),
    })
  } catch (err) {
    next(err)
  }
})

// ─── GET /households/:householdId/statistics/category/:categoryId ────────────

router.get('/category/:categoryId', async (req, res, next) => {
  try {
    const { householdId, categoryId } = req.params as { householdId: string; categoryId: string }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)

    const { month, includePersonal } = req.query as { month?: string; includePersonal?: string }
    const targetMonth = month ?? new Date().toISOString().slice(0, 7)
    const [year, mon] = targetMonth.split('-').map(Number)
    const showPersonal = includePersonal === 'true'

    // All dynamic values are parameterized; placeholder indices are derived from
    // params.length so the order/presence of optional filters cannot collide.
    const params: unknown[] = [householdId, year, mon]
    const isUncategorized = categoryId === 'uncategorized'
    let categoryFilter = 'AND li.category_id IS NULL'
    if (!isUncategorized) {
      params.push(categoryId)
      categoryFilter = `AND li.category_id = $${params.length}`
    }
    let personalFilter = ''
    if (!showPersonal) {
      params.push(userId)
      personalFilter = `AND (li.is_personal = false OR (li.is_personal = true AND e.purchased_by = $${params.length}))`
    }

    const result = await db.query<{
      line_item_id: string
      description: string
      quantity: number
      unit_price_ore: number
      is_personal: boolean
      expense_id: string
      store: string | null
      expense_date: string | null
      purchaser_name: string
    }>(
      `SELECT li.id as line_item_id, li.description, li.quantity, li.unit_price_ore,
              li.is_personal,
              e.id as expense_id, e.store, e.expense_date, u.name as purchaser_name
       FROM line_items li
       JOIN expenses e ON e.id = li.expense_id
       JOIN users u ON u.id = e.purchased_by
       WHERE e.household_id = $1
         AND e.status IN ('confirmed', 'settled')
         AND e.project_id IS NULL
         AND EXTRACT(YEAR FROM e.expense_date) = $2
         AND EXTRACT(MONTH FROM e.expense_date) = $3
         ${categoryFilter}
         ${personalFilter}
       ORDER BY e.expense_date DESC, e.id, li.id
       LIMIT 200`,
      params
    )

    // Look up category name
    let categoryName = 'Uncategorized'
    if (!isUncategorized) {
      const catResult = await db.query<{ name: string }>(
        'SELECT name FROM categories WHERE id = $1',
        [categoryId]
      )
      if (catResult.rows[0]) categoryName = catResult.rows[0].name
    }

    res.json({
      categoryId: isUncategorized ? null : categoryId,
      categoryName,
      items: result.rows.map((r) => ({
        lineItemId: r.line_item_id,
        description: r.description,
        quantity: r.quantity,
        unitPriceOre: r.unit_price_ore,
        isPersonal: r.is_personal,
        expenseId: r.expense_id,
        store: r.store,
        expenseDate: r.expense_date,
        purchaserName: r.purchaser_name,
      })),
    })
  } catch (err) {
    next(err)
  }
})

// ─── GET /households/:householdId/statistics/export ──────────────────────────

router.get('/export', async (req, res, next) => {
  try {
    const { householdId } = req.params as { householdId: string }
    const userId = req.user!.userId
    await requireActiveMember(householdId, userId)

    const { month } = req.query as { month?: string }
    const targetMonth = month ?? new Date().toISOString().slice(0, 7)
    const [year, mon] = targetMonth.split('-').map(Number)

    const result = await db.query<{
      expense_date: string
      store: string | null
      purchaser_name: string
      card_last_four: string | null
      description: string
      quantity: number
      unit_price_ore: number
      tag_name: string | null
      is_personal: boolean
      category_name: string | null
    }>(
      `SELECT e.expense_date, e.store, u.name as purchaser_name, e.card_last_four,
              li.description, li.quantity, li.unit_price_ore, t.name as tag_name, li.is_personal,
              cat.name as category_name
       FROM line_items li
       JOIN expenses e ON e.id = li.expense_id
       JOIN users u ON u.id = e.purchased_by
       LEFT JOIN tags t ON t.id = li.tag_id
       LEFT JOIN categories cat ON cat.id = li.category_id
       WHERE e.household_id = $1
         AND e.status IN ('confirmed', 'settled')
         AND e.project_id IS NULL
         AND EXTRACT(YEAR FROM e.expense_date) = $2
         AND EXTRACT(MONTH FROM e.expense_date) = $3
       ORDER BY e.expense_date, e.id, li.id`,
      [householdId, year, mon]
    )

    const formatNok = (ore: number) => (ore / 100).toFixed(2)

    // Quote a string cell AND neutralize spreadsheet formula injection: a value
    // beginning with = + - @ (or tab/CR) is evaluated as a formula by Excel and
    // Sheets, so a malicious store/item name could exfiltrate data or run a
    // command when the export is opened. Prefix such values with a single quote.
    const csvCell = (value: string | null | undefined): string => {
      const raw = value ?? ''
      const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
      return `"${guarded.replace(/"/g, '""')}"`
    }

    const header = 'Date,Store,Purchased by,Card,Item,Quantity,Unit price (kr),Tag,Category,Personal'
    const rows = result.rows.map((r) =>
      [
        r.expense_date?.toString().slice(0, 10) ?? '',
        csvCell(r.store),
        csvCell(r.purchaser_name),
        r.card_last_four ? `••• ${r.card_last_four}` : '',
        csvCell(r.description),
        r.quantity,
        formatNok(r.unit_price_ore),
        csvCell(r.tag_name),
        csvCell(r.category_name),
        r.is_personal ? 'Yes' : 'No',
      ].join(',')
    )

    const csv = [header, ...rows].join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="expenses-${targetMonth}.csv"`)
    res.send(csv)
  } catch (err) {
    next(err)
  }
})

export { router as statisticsRouter }
