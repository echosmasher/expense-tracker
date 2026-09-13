/**
 * Idempotent draft-expense creation from a receipt intake result — shared by
 * the household and project `from-receipt` routes so the ON CONFLICT / retry
 * logic that makes SC-009 hold (a replayed capture never creates a second
 * expense) lives in exactly one place.
 */
import { db } from '../db/client.js'
import { tagLineItems } from './tagMatcher.js'
import type { ReceiptIntakeResult } from './receiptIntake.js'

export type DraftScope = { householdId: string } | { projectId: string }

export interface CreateDraftResult {
  expenseId: string
  created: boolean
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

  const keywordsResult = await db.query<{ keyword: string }>(
    'SELECT keyword FROM personal_keywords WHERE household_id = $1',
    [ownerHouseholdId]
  )
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

  const totalAmountOre = intake.items.reduce(
    (sum, item, i) => (taggedItems[i]?.isPersonal ? sum : sum + item.unitPriceOre * item.quantity),
    0
  )

  return db.transaction(async (client) => {
    // ON CONFLICT DO NOTHING makes this idempotent under a concurrent retry of
    // the same capture, not just the pre-check a caller might race against.
    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO expenses
         (${scopeColumn}, purchased_by, receipt_image_key, store, expense_date,
          total_amount_ore, card_last_four, status, capture_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_review', $8)
       ON CONFLICT (${scopeColumn}, capture_id) WHERE ${scopeColumn} IS NOT NULL AND capture_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [scopeId, userId, intake.receiptImageKey, intake.store, intake.date, totalAmountOre, intake.cardLastFour, captureId]
    )

    if (insertResult.rows[0]) {
      const expenseId = insertResult.rows[0].id
      for (let idx = 0; idx < intake.items.length; idx++) {
        const item = intake.items[idx]!
        await client.query(
          `INSERT INTO line_items (expense_id, description, quantity, unit_price_ore, is_personal, category_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [expenseId, item.description, item.quantity, item.unitPriceOre, taggedItems[idx]?.isPersonal ?? false, item.categoryId]
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
