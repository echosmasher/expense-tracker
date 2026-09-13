/**
 * Shapes an expense row (+ line items) into the API response shape shared by
 * the household and project expense routes. An expense belongs to exactly
 * one of household_id/project_id (DB constraint `expense_belongs_to_one`),
 * so callers pass whichever scope they're authorizing against.
 */
import { z } from 'zod'
import { db } from '../db/client.js'

export type ExpenseScope = { householdId: string } | { projectId: string }

/** Draft field edits (store, date, purchaser, card) — shared shape for the
 * household and project PATCH /expenses/:expenseId routes. */
export const UpdateExpenseSchema = z.object({
  store: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  purchasedBy: z.string().uuid().optional(),
  cardLastFour: z.string().regex(/^\d{4}$/).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' })

export type UpdateExpenseInput = z.infer<typeof UpdateExpenseSchema>

/** Builds the SET clause + params for the fields UpdateExpenseSchema allows,
 * mapping camelCase input to the snake_case columns on `expenses`. */
export function buildExpenseUpdate(body: UpdateExpenseInput, startAt = 1): { sets: string[]; params: unknown[] } {
  const sets: string[] = []
  const params: unknown[] = []
  let i = startAt
  if (body.store !== undefined) { sets.push(`store = $${i++}`); params.push(body.store) }
  if (body.date !== undefined) { sets.push(`expense_date = $${i++}`); params.push(body.date) }
  if (body.purchasedBy !== undefined) { sets.push(`purchased_by = $${i++}`); params.push(body.purchasedBy) }
  if (body.cardLastFour !== undefined) { sets.push(`card_last_four = $${i++}`); params.push(body.cardLastFour) }
  return { sets, params }
}

interface ExpenseRow {
  id: string
  household_id: string | null
  project_id: string | null
  purchased_by: string
  purchaser_name: string
  receipt_image_key: string | null
  store: string | null
  expense_date: string | null
  total_amount_ore: number
  card_last_four: string | null
  status: string
  capture_id: string | null
  created_at: Date
}

interface LineItemRow {
  id: string
  description: string
  quantity: number
  unit_price_ore: number
  tag_id: string | null
  is_personal: boolean
  category_id: string | null
  category_name: string | null
}

export async function getFullExpense(expenseId: string, scope: ExpenseScope) {
  const scopeColumn = 'householdId' in scope ? 'household_id' : 'project_id'
  const scopeId = 'householdId' in scope ? scope.householdId : scope.projectId

  const expResult = await db.query<ExpenseRow>(
    `SELECT e.*, u.name as purchaser_name
     FROM expenses e JOIN users u ON u.id = e.purchased_by
     WHERE e.id = $1 AND e.${scopeColumn} = $2`,
    [expenseId, scopeId]
  )
  const expense = expResult.rows[0]
  if (!expense) return null

  const itemsResult = await db.query<LineItemRow>(
    `SELECT li.id, li.description, li.quantity, li.unit_price_ore, li.tag_id, li.is_personal,
            li.category_id, c.name as category_name
     FROM line_items li
     LEFT JOIN categories c ON c.id = li.category_id
     WHERE li.expense_id = $1 ORDER BY li.id`,
    [expenseId]
  )

  const receiptImageUrl = expense.receipt_image_key
    ? 'householdId' in scope
      ? `/households/${scope.householdId}/expenses/${expenseId}/receipt`
      : `/projects/${scope.projectId}/expenses/${expenseId}/receipt`
    : null

  return {
    id: expense.id,
    householdId: expense.household_id,
    projectId: expense.project_id,
    purchasedBy: expense.purchased_by,
    purchaserName: expense.purchaser_name,
    receiptImageKey: expense.receipt_image_key,
    receiptImageUrl,
    store: expense.store,
    date: expense.expense_date,
    totalAmountOre: Number(expense.total_amount_ore),
    cardLastFour: expense.card_last_four,
    status: expense.status,
    captureId: expense.capture_id,
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

/** Recompute and persist total_amount_ore from non-personal line items. */
export async function recomputeExpenseTotal(expenseId: string): Promise<number> {
  const totalResult = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(unit_price_ore * quantity), 0)::bigint as total
     FROM line_items WHERE expense_id = $1 AND is_personal = false`,
    [expenseId]
  )
  const total = parseInt(totalResult.rows[0]!.total, 10)
  await db.query('UPDATE expenses SET total_amount_ore = $1, updated_at = now() WHERE id = $2', [total, expenseId])
  return total
}
