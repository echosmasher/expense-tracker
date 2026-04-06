/**
 * Category service — CRUD for categories and category mappings.
 * Mappings store the learned association between item descriptions and categories
 * per household. Both AI and user corrections feed into this mapping table.
 */
import { db } from '../db/client.js'
import { categorizeWithAI, type CategorizationInput } from './categorizer.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Category {
  id: string
  name: string
  isSystem: boolean
}

export interface CategorizedItem {
  index: number
  description: string
  categoryId: string
  categoryName: string
}

// ─── Normalize ──────────────────────────────────────────────────────────────

function normalize(description: string): string {
  return description.toLowerCase().trim()
}

// ─── Core CRUD ──────────────────────────────────────────────────────────────

/**
 * Find an existing category by name (case-insensitive) or create a new one.
 */
export async function getOrCreateCategory(
  householdId: string,
  name: string
): Promise<Category> {
  // Try to find existing (case-insensitive)
  const existing = await db.query<{ id: string; name: string; is_system: boolean }>(
    'SELECT id, name, is_system FROM categories WHERE household_id = $1 AND lower(name) = lower($2)',
    [householdId, name.trim()]
  )
  if (existing.rows[0]) {
    return { id: existing.rows[0].id, name: existing.rows[0].name, isSystem: existing.rows[0].is_system }
  }

  // Create new
  const result = await db.query<{ id: string; name: string; is_system: boolean }>(
    'INSERT INTO categories (household_id, name) VALUES ($1, $2) RETURNING id, name, is_system',
    [householdId, name.trim()]
  )
  return { id: result.rows[0]!.id, name: result.rows[0]!.name, isSystem: result.rows[0]!.is_system }
}

/**
 * Get or create the "Uncategorized" system category for a household.
 */
export async function ensureUncategorizedCategory(householdId: string): Promise<Category> {
  const existing = await db.query<{ id: string; name: string; is_system: boolean }>(
    "SELECT id, name, is_system FROM categories WHERE household_id = $1 AND is_system = true AND lower(name) = 'uncategorized'",
    [householdId]
  )
  if (existing.rows[0]) {
    return { id: existing.rows[0].id, name: existing.rows[0].name, isSystem: true }
  }

  const result = await db.query<{ id: string; name: string; is_system: boolean }>(
    "INSERT INTO categories (household_id, name, is_system) VALUES ($1, 'Uncategorized', true) RETURNING id, name, is_system",
    [householdId]
  )
  return { id: result.rows[0]!.id, name: result.rows[0]!.name, isSystem: true }
}

/**
 * Batch lookup: given an array of raw descriptions, return a map of
 * normalizedDescription -> { categoryId, categoryName } for all found mappings.
 */
export async function lookupMappings(
  householdId: string,
  descriptions: string[]
): Promise<Map<string, { categoryId: string; categoryName: string }>> {
  const map = new Map<string, { categoryId: string; categoryName: string }>()
  if (descriptions.length === 0) return map

  const normalized = descriptions.map(normalize)
  const result = await db.query<{
    normalized_description: string
    category_id: string
    category_name: string
  }>(
    `SELECT cm.normalized_description, cm.category_id, c.name as category_name
     FROM category_mappings cm
     JOIN categories c ON c.id = cm.category_id
     WHERE cm.household_id = $1 AND cm.normalized_description = ANY($2)`,
    [householdId, normalized]
  )

  for (const row of result.rows) {
    map.set(row.normalized_description, {
      categoryId: row.category_id,
      categoryName: row.category_name,
    })
  }
  return map
}

/**
 * Insert or update a mapping. User-source mappings always overwrite AI-source ones.
 */
export async function upsertMapping(
  householdId: string,
  description: string,
  categoryId: string,
  source: 'ai' | 'user'
): Promise<void> {
  const norm = normalize(description)
  await db.query(
    `INSERT INTO category_mappings (household_id, normalized_description, category_id, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (household_id, normalized_description)
     DO UPDATE SET category_id = $3, source = $4, updated_at = now()`,
    [householdId, norm, categoryId, source]
  )
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Categorize a batch of line items using the two-tier strategy:
 * 1. Check saved mappings first (instant, no AI call)
 * 2. Send unmapped items to AI
 * 3. Save confident AI results as new mappings
 * 4. Assign "Uncategorized" to low-confidence items
 */
export async function categorizeLineItems(
  householdId: string,
  items: Array<{ description: string }>
): Promise<CategorizedItem[]> {
  if (items.length === 0) return []

  const uncategorized = await ensureUncategorizedCategory(householdId)

  // Step 1: lookup saved mappings
  const descriptions = items.map((item) => item.description)
  const mappings = await lookupMappings(householdId, descriptions)

  const results: CategorizedItem[] = new Array(items.length)
  const needsAI: CategorizationInput[] = []

  for (let i = 0; i < items.length; i++) {
    const norm = normalize(items[i]!.description)
    const saved = mappings.get(norm)
    if (saved) {
      results[i] = {
        index: i,
        description: items[i]!.description,
        categoryId: saved.categoryId,
        categoryName: saved.categoryName,
      }
    } else {
      needsAI.push({ index: i, description: items[i]!.description })
    }
  }

  // Step 2: AI categorization for unmapped items
  if (needsAI.length > 0) {
    const aiResults = await categorizeWithAI(needsAI)

    for (const aiResult of aiResults) {
      const idx = aiResult.index
      if (aiResult.confidence === 'low') {
        // Don't save mapping for low confidence
        results[idx] = {
          index: idx,
          description: items[idx]!.description,
          categoryId: uncategorized.id,
          categoryName: uncategorized.name,
        }
      } else {
        // High/medium confidence: save the mapping
        const cat = await getOrCreateCategory(householdId, aiResult.category)
        await upsertMapping(householdId, items[idx]!.description, cat.id, 'ai')
        results[idx] = {
          index: idx,
          description: items[idx]!.description,
          categoryId: cat.id,
          categoryName: cat.name,
        }
      }
    }
  }

  // Fill any gaps (shouldn't happen, but safety)
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      results[i] = {
        index: i,
        description: items[i]!.description,
        categoryId: uncategorized.id,
        categoryName: uncategorized.name,
      }
    }
  }

  return results
}

/**
 * Update a line item's category and save the mapping for future auto-categorization.
 * This is the user correction flow.
 */
export async function updateLineItemCategory(
  householdId: string,
  lineItemId: string,
  categoryName: string
): Promise<{ lineItemId: string; categoryId: string; categoryName: string; mappingSaved: boolean }> {
  // Get the line item description for the mapping
  const liResult = await db.query<{ description: string; expense_id: string }>(
    'SELECT description, expense_id FROM line_items WHERE id = $1',
    [lineItemId]
  )
  const lineItem = liResult.rows[0]
  if (!lineItem) {
    throw new Error('Line item not found')
  }

  // Find or create the category
  const category = await getOrCreateCategory(householdId, categoryName)

  // Update line item
  await db.query(
    'UPDATE line_items SET category_id = $1 WHERE id = $2',
    [category.id, lineItemId]
  )

  // Save mapping (user source always wins)
  await upsertMapping(householdId, lineItem.description, category.id, 'user')

  return {
    lineItemId,
    categoryId: category.id,
    categoryName: category.name,
    mappingSaved: true,
  }
}
