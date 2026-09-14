/**
 * Idempotent draft-expense creation from a receipt intake result — shared by
 * the household and project `from-receipt` routes so the ON CONFLICT / retry
 * logic that makes SC-009 hold (a replayed capture never creates a second
 * expense) lives in exactly one place.
 */
import { db } from '../db/client.js'
import { tagLineItems } from './tagMatcher.js'
import { resolveRate } from './exchangeRates.js'
import { convertForeignLine } from './expenseView.js'
import { getCurrency } from '@expense-tracker/shared'
import type { ReceiptIntakeResult } from './receiptIntake.js'

export type DraftScope = { householdId: string } | { projectId: string }

export interface CreateDraftResult {
  expenseId: string
  created: boolean
}

/**
 * Resolve a foreign-currency draft's rate at creation time (which, for a
 * queued/flushed capture, is flush time — spec 005 ticket 14, scenario 9),
 * and convert every line to its home-currency amount. A rate that cannot be
 * resolved leaves the draft with `rate_source = 'pending'` and zero home
 * amounts rather than blocking draft creation (confirm rejects it later).
 */
interface ResolvedCurrency {
  currency: string
  isForeign: boolean
  rateScaled: bigint | null
  rateDate: string | null
  rateSource: string | null
  rateCapturedAt: Date | null
  exponent: number | undefined
}

async function resolveDraftCurrency(
  parsedCurrency: string | null,
  projectDefaultCurrency: string | null,
  onDate: string | null
): Promise<ResolvedCurrency> {
  const currency = (parsedCurrency ?? projectDefaultCurrency ?? 'NOK').toUpperCase()
  const isForeign = currency !== 'NOK'
  if (!isForeign) {
    return { currency, isForeign, rateScaled: null, rateDate: null, rateSource: null, rateCapturedAt: null, exponent: undefined }
  }

  const currencyInfo = getCurrency(currency)
  const resolved = currencyInfo ? await resolveRate(currency, onDate ?? new Date().toISOString().slice(0, 10)) : null
  if (!resolved) {
    return { currency, isForeign, rateScaled: null, rateDate: null, rateSource: 'pending', rateCapturedAt: null, exponent: currencyInfo?.exponent }
  }
  return {
    currency,
    isForeign,
    rateScaled: resolved.rateScaled,
    rateDate: resolved.rateDate,
    rateSource: resolved.source,
    rateCapturedAt: new Date(),
    exponent: currencyInfo?.exponent,
  }
}

export async function createDraftFromIntake(
  scope: DraftScope,
  ownerHouseholdId: string,
  userId: string,
  captureId: string,
  intake: ReceiptIntakeResult
): Promise<CreateDraftResult> {
  const scopeColumn = 'householdId' in scope ? 'household_id' : 'project_id'
  const scopeId = 'householdId' in scope ? scope.householdId : scope.projectId

  const [keywordsResult, projectDefaultCurrency] = await Promise.all([
    db.query<{ keyword: string }>('SELECT keyword FROM personal_keywords WHERE household_id = $1', [ownerHouseholdId]),
    'projectId' in scope
      ? db.query<{ default_currency: string | null }>('SELECT default_currency FROM projects WHERE id = $1', [scope.projectId])
          .then((r) => r.rows[0]?.default_currency ?? null)
      : Promise.resolve(null),
  ])
  const keywords = keywordsResult.rows.map((r) => r.keyword)
  const taggedItems = tagLineItems(
    intake.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPriceOre: item.unitPriceOre,
      confidenceLow: item.confidenceLow,
    })),
    keywords
  )

  const resolved = await resolveDraftCurrency(intake.currency, projectDefaultCurrency, intake.date)

  // For a foreign draft, `item.unitPriceOre` (per ReceiptIntakeResult) is in
  // the detected currency's minor unit — convert it to home-currency amounts
  // now; a pending rate converts to zero, matching a rate correction later.
  const lineAmounts = intake.items.map((item) => {
    if (!resolved.isForeign) {
      return { unitPriceOre: item.unitPriceOre, totalPriceOre: item.unitPriceOre * item.quantity, originalUnitPriceMinor: null as number | null, originalTotalMinor: null as number | null }
    }
    if (resolved.rateScaled === null || resolved.exponent === undefined) {
      return { unitPriceOre: 0, totalPriceOre: 0, originalUnitPriceMinor: item.unitPriceOre, originalTotalMinor: item.unitPriceOre * item.quantity }
    }
    const converted = convertForeignLine(item.unitPriceOre, item.quantity, resolved.rateScaled, resolved.exponent)
    return { unitPriceOre: converted.unitPriceOre, totalPriceOre: converted.totalPriceOre, originalUnitPriceMinor: item.unitPriceOre, originalTotalMinor: converted.originalTotalMinor }
  })

  const totalAmountOre = lineAmounts.reduce(
    (sum, amounts, i) => (taggedItems[i]?.isPersonal ? sum : sum + amounts.totalPriceOre),
    0
  )
  const originalTotalMinor = resolved.isForeign
    ? lineAmounts.reduce((sum, amounts) => sum + (amounts.originalTotalMinor ?? 0), 0)
    : null

  return db.transaction(async (client) => {
    // ON CONFLICT DO NOTHING makes this idempotent under a concurrent retry of
    // the same capture, not just the pre-check a caller might race against.
    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO expenses
         (${scopeColumn}, purchased_by, receipt_image_key, store, expense_date,
          total_amount_ore, card_last_four, status, capture_id,
          currency, original_total_minor, rate_scaled, rate_date, rate_source, rate_captured_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_review', $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (${scopeColumn}, capture_id) WHERE ${scopeColumn} IS NOT NULL AND capture_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        scopeId, userId, intake.receiptImageKey, intake.store, intake.date, totalAmountOre, intake.cardLastFour, captureId,
        resolved.currency, originalTotalMinor,
        resolved.rateScaled !== null ? resolved.rateScaled.toString() : null,
        resolved.rateDate, resolved.rateSource, resolved.rateCapturedAt,
      ]
    )

    if (insertResult.rows[0]) {
      const expenseId = insertResult.rows[0].id
      for (let idx = 0; idx < intake.items.length; idx++) {
        const item = intake.items[idx]!
        const amounts = lineAmounts[idx]!
        await client.query(
          `INSERT INTO line_items
             (expense_id, description, quantity, unit_price_ore, total_price_ore, is_personal, category_id,
              original_unit_price_minor, original_total_minor)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            expenseId,
            item.description,
            item.quantity,
            amounts.unitPriceOre,
            amounts.totalPriceOre,
            taggedItems[idx]?.isPersonal ?? false,
            item.categoryId,
            amounts.originalUnitPriceMinor,
            amounts.originalTotalMinor,
          ]
        )
      }
      return { expenseId, created: true }
    }

    // Lost the race (or this is a genuine replay): the row already exists.
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM expenses WHERE ${scopeColumn} = $1 AND capture_id = $2`,
      [scopeId, captureId]
    )
    return { expenseId: existing.rows[0]!.id, created: false }
  })
}
