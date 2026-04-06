import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'
import { db } from '../../db/client.js'
import { updateLineItemCategory } from '../../services/categoryService.js'

const router = Router({ mergeParams: true })
router.use(requireAuth)

// ─── Helpers ────────────────────────────────────────────────────────────────

async function requireMember(householdId: string, userId: string) {
  const result = await db.query(
    'SELECT id FROM household_members WHERE household_id = $1 AND user_id = $2',
    [householdId, userId]
  )
  if (result.rows.length === 0) throw new AppError(403, 'FORBIDDEN', 'Not a member of this household')
}

async function requireAdmin(householdId: string, userId: string) {
  const result = await db.query(
    "SELECT id FROM household_members WHERE household_id = $1 AND user_id = $2 AND role = 'admin'",
    [householdId, userId]
  )
  if (result.rows.length === 0) throw new AppError(403, 'ADMIN_ONLY', 'Only the household admin can perform this action')
}

// ─── GET /households/:householdId/categories ────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { householdId } = req.params as { householdId: string }
    await requireMember(householdId, req.user!.userId)

    const result = await db.query<{
      id: string
      name: string
      is_system: boolean
      mapping_count: string
    }>(
      `SELECT c.id, c.name, c.is_system,
              COUNT(cm.id)::int as mapping_count
       FROM categories c
       LEFT JOIN category_mappings cm ON cm.category_id = c.id
       WHERE c.household_id = $1
       GROUP BY c.id, c.name, c.is_system
       ORDER BY c.is_system ASC, c.name ASC`,
      [householdId]
    )

    res.json({
      categories: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        isSystem: r.is_system,
        mappingCount: parseInt(r.mapping_count, 10),
      })),
    })
  } catch (err) {
    next(err)
  }
})

// ─── PATCH /households/:householdId/categories/:categoryId ──────────────────

const RenameCategorySchema = z.object({ name: z.string().min(1) })

router.patch('/:categoryId', async (req, res, next) => {
  try {
    const { householdId, categoryId } = req.params as { householdId: string; categoryId: string }
    await requireAdmin(householdId, req.user!.userId)

    const { name } = RenameCategorySchema.parse(req.body)

    // Check source category exists and is not system
    const source = await db.query<{ id: string; name: string; is_system: boolean }>(
      'SELECT id, name, is_system FROM categories WHERE id = $1 AND household_id = $2',
      [categoryId, householdId]
    )
    if (!source.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Category not found')
    if (source.rows[0].is_system) throw new AppError(400, 'CANNOT_MODIFY_SYSTEM_CATEGORY', 'Cannot rename a system category')

    // Check if target name already exists (merge case)
    const target = await db.query<{ id: string; name: string }>(
      'SELECT id, name FROM categories WHERE household_id = $1 AND lower(name) = lower($2) AND id != $3',
      [householdId, name.trim(), categoryId]
    )

    if (target.rows[0]) {
      // Merge: move all mappings and line items from source to target, then delete source
      const targetId = target.rows[0].id
      await db.transaction(async (client) => {
        await client.query(
          'UPDATE category_mappings SET category_id = $1, updated_at = now() WHERE category_id = $2',
          [targetId, categoryId]
        )
        await client.query(
          'UPDATE line_items SET category_id = $1 WHERE category_id = $2',
          [targetId, categoryId]
        )
        await client.query('DELETE FROM categories WHERE id = $1', [categoryId])
      })

      res.json({ id: targetId, name: target.rows[0].name, merged: true })
    } else {
      // Simple rename
      await db.query(
        'UPDATE categories SET name = $1 WHERE id = $2',
        [name.trim(), categoryId]
      )
      res.json({ id: categoryId, name: name.trim(), merged: false })
    }
  } catch (err) {
    next(err)
  }
})

// ─── DELETE /households/:householdId/categories/:categoryId ─────────────────

router.delete('/:categoryId', async (req, res, next) => {
  try {
    const { householdId, categoryId } = req.params as { householdId: string; categoryId: string }
    await requireAdmin(householdId, req.user!.userId)

    const cat = await db.query<{ id: string; is_system: boolean }>(
      'SELECT id, is_system FROM categories WHERE id = $1 AND household_id = $2',
      [categoryId, householdId]
    )
    if (!cat.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Category not found')
    if (cat.rows[0].is_system) throw new AppError(400, 'CANNOT_MODIFY_SYSTEM_CATEGORY', 'Cannot delete a system category')

    // Get uncategorized ID to reassign
    const uncatResult = await db.query<{ id: string }>(
      "SELECT id FROM categories WHERE household_id = $1 AND is_system = true AND lower(name) = 'uncategorized'",
      [householdId]
    )
    const uncatId = uncatResult.rows[0]?.id

    await db.transaction(async (client) => {
      // Delete mappings pointing to this category
      await client.query('DELETE FROM category_mappings WHERE category_id = $1', [categoryId])
      // Reassign line items to Uncategorized (or null if somehow missing)
      await client.query(
        'UPDATE line_items SET category_id = $1 WHERE category_id = $2',
        [uncatId ?? null, categoryId]
      )
      await client.query('DELETE FROM categories WHERE id = $1', [categoryId])
    })

    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

// ─── PATCH /households/:householdId/expenses/:expenseId/line-items/:lineItemId/category

const UpdateCategorySchema = z.object({ categoryName: z.string().min(1) })

const lineItemCategoryRouter = Router({ mergeParams: true })
lineItemCategoryRouter.use(requireAuth)

lineItemCategoryRouter.patch('/', async (req, res, next) => {
  try {
    const { householdId, expenseId, lineItemId } = req.params as {
      householdId: string
      expenseId: string
      lineItemId: string
    }
    const userId = req.user!.userId
    await requireMember(householdId, userId)

    // Verify expense belongs to household
    const expCheck = await db.query(
      'SELECT id FROM expenses WHERE id = $1 AND household_id = $2',
      [expenseId, householdId]
    )
    if (expCheck.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Expense not found in this household')

    // Verify line item belongs to expense
    const liCheck = await db.query(
      'SELECT id FROM line_items WHERE id = $1 AND expense_id = $2',
      [lineItemId, expenseId]
    )
    if (liCheck.rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Line item not found in this expense')

    const { categoryName } = UpdateCategorySchema.parse(req.body)
    const result = await updateLineItemCategory(householdId, lineItemId, categoryName)

    res.json(result)
  } catch (err) {
    next(err)
  }
})

export { router as categoriesRouter, lineItemCategoryRouter }
