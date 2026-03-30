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
    const personalFilter = showPersonal
      ? ''
      : `AND (li.is_personal = false OR (li.is_personal = true AND e.purchased_by = '${userId}'))`

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
      [householdId, year, mon]
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
    }>(
      `SELECT e.expense_date, e.store, u.name as purchaser_name, e.card_last_four,
              li.description, li.quantity, li.unit_price_ore, t.name as tag_name, li.is_personal
       FROM line_items li
       JOIN expenses e ON e.id = li.expense_id
       JOIN users u ON u.id = e.purchased_by
       LEFT JOIN tags t ON t.id = li.tag_id
       WHERE e.household_id = $1
         AND e.status IN ('confirmed', 'settled')
         AND e.project_id IS NULL
         AND EXTRACT(YEAR FROM e.expense_date) = $2
         AND EXTRACT(MONTH FROM e.expense_date) = $3
       ORDER BY e.expense_date, e.id, li.id`,
      [householdId, year, mon]
    )

    const formatNok = (ore: number) => (ore / 100).toFixed(2)

    const header = 'Date,Store,Purchased by,Card,Item,Quantity,Unit price (kr),Tag,Personal'
    const rows = result.rows.map((r) =>
      [
        r.expense_date?.toString().slice(0, 10) ?? '',
        `"${(r.store ?? '').replace(/"/g, '""')}"`,
        `"${r.purchaser_name.replace(/"/g, '""')}"`,
        r.card_last_four ? `••• ${r.card_last_four}` : '',
        `"${r.description.replace(/"/g, '""')}"`,
        r.quantity,
        formatNok(r.unit_price_ore),
        `"${(r.tag_name ?? '').replace(/"/g, '""')}"`,
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
