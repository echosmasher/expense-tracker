/**
 * Shapes an expense row (+ line items) into the API response shape shared by
 * the household and project expense routes. An expense belongs to exactly
 * one of household_id/project_id (DB constraint `expense_belongs_to_one`),
 * so callers pass whichever scope they're authorizing against.
 */
import { z } from 'zod'
import { db } from '../db/client.js'
import { homeOre, getCurrency } from '@expense-tracker/shared'
import { AppError } from '../api/middleware/error.js'
import { resolveRate } from './exchangeRates.js'

export type ExpenseScope = { householdId: string } | { projectId: string }

/** Draft field edits (store, date, purchaser, card, currency) — shared shape
 * for the household and project PATCH /expenses/:expenseId routes. Changing
 * `currency` is handled separately by `changeExpenseCurrency` (it touches
 * every line item, not a single column) — see the route handlers. */
export const UpdateExpenseSchema = z.object({
  store: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  purchasedBy: z.string().uuid().optional(),
  cardLastFour: z.string().regex(/^\d{4}$/).optional(),
  currency: z.string().length(3).optional(),
  // Supplied together with `currency` to skip rate resolution and record a
  // member-entered rate directly (`rate_source = 'manual'`).
  rateScaled: z.number().int().positive().optional(),
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
  currency: string
  original_total_minor: string | null
  rate_scaled: string | null
  rate_date: string | null
  rate_source: string | null
  rate_captured_at: Date | null
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
  original_unit_price_minor: string | null
  original_total_minor: string | null
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
            li.category_id, c.name as category_name, li.original_unit_price_minor, li.original_total_minor
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
    currency: expense.currency,
    originalTotalMinor: expense.original_total_minor === null ? null : Number(expense.original_total_minor),
    rateScaled: expense.rate_scaled === null ? null : expense.rate_scaled,
    rateDate: expense.rate_date,
    rateSource: expense.rate_source,
    rateCapturedAt: expense.rate_captured_at,
    lineItems: itemsResult.rows.map((li) => ({
      id: li.id,
      description: li.description,
      quantity: li.quantity,
      unitPriceOre: li.unit_price_ore,
      tagId: li.tag_id,
      isPersonal: li.is_personal,
      categoryId: li.category_id,
      categoryName: li.category_name,
      originalUnitPriceMinor: li.original_unit_price_minor === null ? null : Number(li.original_unit_price_minor),
      originalTotalMinor: li.original_total_minor === null ? null : Number(li.original_total_minor),
    })),
  }
}

/**
 * Convert one foreign-currency line item to its home-currency amounts.
 *
 * `totalPriceOre` is converted directly from the line's original TOTAL
 * (unit × quantity), per the money model — never derived by multiplying a
 * rounded per-unit conversion by quantity, which can drift from the
 * direct conversion once quantity > 1. `unitPriceOre` is a separate,
 * display-only conversion of the original unit price and must never be used
 * to derive the stored total.
 */
export function convertForeignLine(
  originalUnitPriceMinor: number,
  quantity: number,
  rateScaled: bigint,
  exponent: number
): { unitPriceOre: number; totalPriceOre: number; originalTotalMinor: number } {
  const originalTotalMinor = originalUnitPriceMinor * quantity
  return {
    unitPriceOre: homeOre(originalUnitPriceMinor, rateScaled, exponent),
    totalPriceOre: homeOre(originalTotalMinor, rateScaled, exponent),
    originalTotalMinor,
  }
}

export interface ExpenseCurrencyContext {
  currency: string
  isForeign: boolean
  rateScaled: bigint | null
  exponent: number | undefined
}

/** The draft's current currency and rate, for deriving a new line item's
 * home-currency amounts (add/edit line-item routes). */
export async function getExpenseCurrencyContext(expenseId: string): Promise<ExpenseCurrencyContext> {
  const result = await db.query<{ currency: string; rate_scaled: string | null }>(
    'SELECT currency, rate_scaled FROM expenses WHERE id = $1',
    [expenseId]
  )
  const row = result.rows[0]
  if (!row) throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found')
  const isForeign = row.currency !== 'NOK'
  // A currency unknown to CURRENCIES (Norges Bank's list) can still carry a
  // manual rate (see changeExpenseCurrency) — falls back to a 2-decimal
  // exponent, same as there.
  return {
    currency: row.currency,
    isForeign,
    rateScaled: row.rate_scaled !== null ? BigInt(row.rate_scaled) : null,
    exponent: isForeign ? (getCurrency(row.currency)?.exponent ?? 2) : undefined,
  }
}

/** Derive a foreign line's home-currency amounts from its original amount and
 * the draft's current rate. A pending rate (no rateScaled yet) converts to
 * zero home amounts — matching draft creation — until a rate is set. */
export function computeForeignLineAmounts(
  originalUnitPriceMinor: number,
  quantity: number,
  ctx: ExpenseCurrencyContext
): { unitPriceOre: number; totalPriceOre: number; originalTotalMinor: number } {
  const originalTotalMinor = originalUnitPriceMinor * quantity
  if (ctx.rateScaled === null || ctx.exponent === undefined) {
    return { unitPriceOre: 0, totalPriceOre: 0, originalTotalMinor }
  }
  return convertForeignLine(originalUnitPriceMinor, quantity, ctx.rateScaled, ctx.exponent)
}

/**
 * Change a draft's currency (spec 005 ticket 14): re-resolves the rate
 * (unless `manualRateScaled` is supplied, which is stored as `'manual'`
 * directly) and reconverts every line item. Switching to the home currency
 * clears rate metadata and each line's original amount; the last-converted
 * home amounts are kept as-is since there is no other home-currency source
 * to fall back to.
 */
export async function changeExpenseCurrency(
  expenseId: string,
  newCurrencyRaw: string,
  manualRateScaled: bigint | null
): Promise<void> {
  const newCurrency = newCurrencyRaw.toUpperCase()
  const isForeign = newCurrency !== 'NOK'
  const currencyInfo = isForeign ? getCurrency(newCurrency) : undefined
  // A currency Norges Bank doesn't publish (spec 005 edge case: "the parser
  // reports a currency Norges Bank does not publish — the expense can still
  // be created with a manually entered rate") is only rejected when there's
  // no manual rate to rescue it; automatic resolution has nothing to look up
  // without a known currency. An unknown currency without a rate table entry
  // falls back to a 2-decimal exponent — the same assumption the parser
  // makes when it can't be more specific.
  if (isForeign && !currencyInfo && manualRateScaled === null) {
    throw new AppError(400, 'UNKNOWN_CURRENCY', `Unknown currency: ${newCurrency}`)
  }
  const exponent = currencyInfo?.exponent ?? 2

  const expenseResult = await db.query<{ expense_date: string | null }>(
    'SELECT expense_date::text as expense_date FROM expenses WHERE id = $1',
    [expenseId]
  )
  const expenseRow = expenseResult.rows[0]
  if (!expenseRow) throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found')

  let rateScaled: bigint | null = null
  let rateDate: string | null = null
  let rateSource: string | null = null
  let rateCapturedAt: Date | null = null

  if (isForeign) {
    if (manualRateScaled !== null) {
      rateScaled = manualRateScaled
      rateSource = 'manual'
      rateCapturedAt = new Date()
    } else {
      const onDate = expenseRow.expense_date ?? new Date().toISOString().slice(0, 10)
      const resolved = await resolveRate(newCurrency, onDate)
      if (resolved) {
        rateScaled = resolved.rateScaled
        rateDate = resolved.rateDate
        rateSource = resolved.source
        rateCapturedAt = new Date()
      } else {
        rateSource = 'pending'
      }
    }
  }

  await db.transaction(async (client) => {
    await client.query(
      `UPDATE expenses SET currency = $1, rate_scaled = $2, rate_date = $3, rate_source = $4, rate_captured_at = $5
       WHERE id = $6`,
      [newCurrency, rateScaled !== null ? rateScaled.toString() : null, rateDate, rateSource, rateCapturedAt, expenseId]
    )

    const lineItems = await client.query<{
      id: string; quantity: number; unit_price_ore: number; original_unit_price_minor: string | null
    }>('SELECT id, quantity, unit_price_ore, original_unit_price_minor FROM line_items WHERE expense_id = $1', [expenseId])

    for (const li of lineItems.rows) {
      if (!isForeign) {
        await client.query(
          'UPDATE line_items SET original_unit_price_minor = NULL, original_total_minor = NULL WHERE id = $1',
          [li.id]
        )
        continue
      }
      // Reuse the existing original amount when switching between two
      // foreign currencies; a draft that was previously home-currency has no
      // original amount yet, so its current home unit price seeds it.
      const originalUnitPriceMinor =
        li.original_unit_price_minor !== null ? Number(li.original_unit_price_minor) : li.unit_price_ore

      if (rateScaled !== null) {
        const converted = convertForeignLine(originalUnitPriceMinor, li.quantity, rateScaled, exponent)
        await client.query(
          `UPDATE line_items
           SET original_unit_price_minor = $1, original_total_minor = $2, unit_price_ore = $3, total_price_ore = $4
           WHERE id = $5`,
          [originalUnitPriceMinor, converted.originalTotalMinor, converted.unitPriceOre, converted.totalPriceOre, li.id]
        )
      } else {
        const originalTotalMinor = originalUnitPriceMinor * li.quantity
        await client.query(
          `UPDATE line_items
           SET original_unit_price_minor = $1, original_total_minor = $2, unit_price_ore = 0, total_price_ore = 0
           WHERE id = $3`,
          [originalUnitPriceMinor, originalTotalMinor, li.id]
        )
      }
    }
  })

  // Recomputes total_amount_ore and, since `currency` was just set above,
  // also refreshes original_total_minor from the reconverted line items.
  await recomputeExpenseTotal(expenseId)
}

/** Recompute and persist total_amount_ore (and, for a foreign expense,
 * original_total_minor — the sum of every line's original amount) from the
 * current line items. Called after any line-item add/edit/delete. */
export async function recomputeExpenseTotal(expenseId: string): Promise<number> {
  const totalResult = await db.query<{ total: string; currency: string; original_total: string | null }>(
    `SELECT
       (SELECT COALESCE(SUM(total_price_ore), 0)::bigint FROM line_items WHERE expense_id = $1 AND is_personal = false) as total,
       (SELECT COALESCE(SUM(original_total_minor), 0)::bigint FROM line_items WHERE expense_id = $1) as original_total,
       e.currency
     FROM expenses e WHERE e.id = $1`,
    [expenseId]
  )
  const row = totalResult.rows[0]!
  const total = parseInt(row.total, 10)
  const originalTotalMinor = row.currency !== 'NOK' ? row.original_total : null
  await db.query(
    'UPDATE expenses SET total_amount_ore = $1, original_total_minor = $2, updated_at = now() WHERE id = $3',
    [total, originalTotalMinor, expenseId]
  )
  return total
}
