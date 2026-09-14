/**
 * Receipt intake pipeline — sanitise, store, parse, match the card, and
 * categorise a single uploaded receipt image. Shared by the household and
 * project `from-receipt` routes (and previously by the now-removed
 * `POST /receipts/parse`) so the pipeline exists in exactly one place.
 */
import { uploadFile } from '../storage/minio.js'
import { parseReceipt } from './receiptParser.js'
import { sanitizeImage } from './imageSanitizer.js'
import { categorizeLineItems } from './categoryService.js'
import { db } from '../db/client.js'

export interface IntakeItem {
  description: string
  quantity: number
  unitPriceOre: number
  confidenceLow: boolean
  categoryId: string | null
  categoryName: string
}

export interface ReceiptIntakeResult {
  receiptImageKey: string
  store: string | null
  date: string | null
  cardLastFour: string | null
  // ISO 4217 code as detected by the parser, or null (see ParsedReceipt).
  // `items[].unitPriceOre` is in this currency's minor unit when set.
  currency: string | null
  items: IntakeItem[]
}

/**
 * @param householdId Card matching and category mappings are always
 *   household-scoped — for a project capture, pass the project's owning
 *   household, not the project id.
 * @param keyPrefix Storage key prefix, e.g. `receipts/{householdId}` or
 *   `receipts/projects/{projectId}`.
 */
export async function intakeReceipt(
  householdId: string,
  keyPrefix: string,
  fileBuffer: Buffer
): Promise<ReceiptIntakeResult> {
  // Re-encode to strip metadata (incl. GPS EXIF) and validate it's a real
  // image before it touches storage or leaves the perimeter to OpenAI.
  const image = await sanitizeImage(fileBuffer)

  const key = `${keyPrefix}/${Date.now()}-${Math.random().toString(36).slice(2)}.${image.ext}`
  await uploadFile(key, image.buffer, image.mimetype)

  const parsed = await parseReceipt(image.buffer, image.mimetype)

  // Match detected card last four against household member cards.
  let matchedCardLastFour: string | null = parsed.detectedCardLastFour
  if (matchedCardLastFour) {
    const cardCheck = await db.query(
      `SELECT c.last_four FROM cards c
       JOIN household_members hm ON hm.user_id = c.user_id
       WHERE hm.household_id = $1 AND c.last_four = $2`,
      [householdId, matchedCardLastFour]
    )
    if (cardCheck.rows.length === 0) {
      matchedCardLastFour = null // detected but not registered in household
    }
  }

  // Categorize items (two-tier: saved mappings first, then AI).
  const categorized = await categorizeLineItems(
    householdId,
    parsed.items.map((item) => ({ description: item.description }))
  )

  return {
    receiptImageKey: key,
    store: parsed.store,
    date: parsed.date,
    cardLastFour: matchedCardLastFour,
    currency: parsed.currency,
    items: parsed.items.map((item, i) => ({
      description: item.description,
      quantity: item.quantity,
      unitPriceOre: item.unitPriceOre,
      confidenceLow: item.confidenceLow,
      categoryId: categorized[i]?.categoryId ?? null,
      categoryName: categorized[i]?.categoryName ?? 'Uncategorized',
    })),
  }
}
