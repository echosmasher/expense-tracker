// Ticket 12 (spec 005): line_items.total_price_ore is now the stored,
// authoritative home-currency line total, backfilled by migration 010 and
// written by every insert/edit path. This suite pins SC-003 — statistics and
// settlement output must be byte-identical to what the old
// unit_price_ore * quantity read-time computation produced.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'

vi.mock('../src/services/email.js', () => ({
  sendInviteEmail: vi.fn(async () => {}),
  sendSettlementReadyEmail: vi.fn(async () => {}),
}))

import { app } from '../src/app.js'
import { db } from '../src/db/client.js'

interface TestUser {
  id: string
  email: string
  token: string
}

async function registerUser(name: string, email: string): Promise<TestUser> {
  const passwordHash = await bcrypt.hash('correct-horse-battery', 12)
  const insert = await db.query<{ id: string }>(
    'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
    [email, passwordHash, name]
  )
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'correct-horse-battery' })
  expect(login.status).toBe(200)
  return { id: insert.rows[0]!.id, email, token: login.body.accessToken }
}

async function createActiveHousehold(admin: TestUser, name: string): Promise<string> {
  const createRes = await request(app)
    .post('/api/v1/households')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ name, allocationKey: [{ userId: admin.id, shareBp: 10_000 }] })
  expect(createRes.status).toBe(201)
  const householdId: string = createRes.body.id
  await db.query("UPDATE households SET status = 'active' WHERE id = $1", [householdId])
  return householdId
}

let admin: TestUser
let householdId: string
let month: string

beforeAll(async () => {
  admin = await registerUser('Line Item Admin', 'lineitem-admin@example.com')
  householdId = await createActiveHousehold(admin, 'Line Item Household')
  month = '2026-06'

  // A mix of quantities, a personal item (excluded from totals), and a
  // multi-item expense — deliberately not the "quantity 1" trivial case, so
  // unit_price_ore * quantity and the stored total_price_ore would diverge
  // if either path were wrong.
  const createRes = await request(app)
    .post(`/api/v1/households/${householdId}/expenses`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({
      store: 'Totals Test Store',
      date: `${month}-15`,
      purchasedBy: admin.id,
      lineItems: [
        { description: 'Bulk rice', quantity: 3, unitPriceOre: 4_990 },
        { description: 'Sneaky snack', quantity: 2, unitPriceOre: 1_500, isPersonal: true },
        { description: 'Coffee beans', quantity: 1, unitPriceOre: 12_900 },
      ],
    })
  expect(createRes.status).toBe(201)
  const expenseId: string = createRes.body.id

  const confirmRes = await request(app)
    .post(`/api/v1/households/${householdId}/expenses/${expenseId}/confirm`)
    .set('Authorization', `Bearer ${admin.token}`)
  expect(confirmRes.status).toBe(200)

  // Edit one line item after confirmation isn't allowed, so exercise the
  // line-item PATCH path (which also writes total_price_ore) on a second,
  // still-draft expense.
  const draftRes = await request(app)
    .post(`/api/v1/households/${householdId}/expenses`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({
      store: 'Draft Edit Store',
      date: `${month}-16`,
      purchasedBy: admin.id,
      lineItems: [{ description: 'Placeholder', quantity: 1, unitPriceOre: 1_000 }],
    })
  expect(draftRes.status).toBe(201)
  const draftLineItemId: string = draftRes.body.lineItems[0].id
  const patchRes = await request(app)
    .patch(`/api/v1/households/${householdId}/expenses/${draftRes.body.id}/line-items/${draftLineItemId}`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ unitPriceOre: 2_345, quantity: 4 })
  expect(patchRes.status).toBe(200)
  await request(app)
    .post(`/api/v1/households/${householdId}/expenses/${draftRes.body.id}/confirm`)
    .set('Authorization', `Bearer ${admin.token}`)
})

describe('line_items.total_price_ore', () => {
  it('is non-null and equals unit_price_ore * quantity for every row (migration 010 invariant)', async () => {
    const rows = await db.query<{ unit_price_ore: number; quantity: number; total_price_ore: number | null }>(
      `SELECT li.unit_price_ore, li.quantity, li.total_price_ore
       FROM line_items li
       JOIN expenses e ON e.id = li.expense_id
       WHERE e.household_id = $1`,
      [householdId]
    )
    expect(rows.rows.length).toBeGreaterThan(0)
    for (const row of rows.rows) {
      expect(row.total_price_ore).not.toBeNull()
      expect(row.total_price_ore).toBe(row.unit_price_ore * row.quantity)
    }
  })

  it('produces a statistics total byte-identical to the old read-time computation (SC-003)', async () => {
    // includePersonal=true so the statistics endpoint's personal filter is a
    // no-op, matching these unfiltered SUMs exactly.
    const legacy = await db.query<{ total: string }>(
      `SELECT COALESCE(SUM(li.unit_price_ore * li.quantity), 0)::bigint as total
       FROM line_items li
       JOIN expenses e ON e.id = li.expense_id
       WHERE e.household_id = $1
         AND e.status IN ('confirmed', 'settled')
         AND e.project_id IS NULL
         AND TO_CHAR(e.expense_date, 'YYYY-MM') = $2`,
      [householdId, month]
    )
    const stored = await db.query<{ total: string }>(
      `SELECT COALESCE(SUM(li.total_price_ore), 0)::bigint as total
       FROM line_items li
       JOIN expenses e ON e.id = li.expense_id
       WHERE e.household_id = $1
         AND e.status IN ('confirmed', 'settled')
         AND e.project_id IS NULL
         AND TO_CHAR(e.expense_date, 'YYYY-MM') = $2`,
      [householdId, month]
    )
    expect(legacy.rows[0]!.total).toBe(stored.rows[0]!.total)

    const statsRes = await request(app)
      .get(`/api/v1/households/${householdId}/statistics?month=${month}&includePersonal=true`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(statsRes.status).toBe(200)
    expect(String(statsRes.body.totalOre)).toBe(stored.rows[0]!.total)
  })

  it('produces a settlement total byte-identical to the old read-time computation (SC-003)', async () => {
    const legacy = await db.query<{ total: string }>(
      `SELECT COALESCE(SUM(li.unit_price_ore * li.quantity), 0)::bigint as total
       FROM line_items li
       JOIN expenses e ON e.id = li.expense_id
       WHERE e.household_id = $1
         AND e.status = 'confirmed'
         AND e.project_id IS NULL
         AND li.is_personal = false`,
      [householdId]
    )

    const triggerRes = await request(app)
      .post(`/api/v1/households/${householdId}/settlements`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(triggerRes.status).toBe(201)

    const detailRes = await request(app)
      .get(`/api/v1/households/${householdId}/settlements/${triggerRes.body.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(detailRes.status).toBe(200)

    const settledTotal = detailRes.body.includedExpenses.reduce(
      (sum: number, e: { totalAmountOre: number }) => sum + e.totalAmountOre,
      0
    )
    expect(String(settledTotal)).toBe(legacy.rows[0]!.total)
  })

  it('migration 010 backfills a null total_price_ore byte-identically to unit_price_ore * quantity', async () => {
    // Exercises the exact backfill statement from migration 010 against a
    // manufactured pre-migration row (NOT NULL is dropped just for this
    // insert, mirroring the column's state before the migration ran).
    await db.transaction(async (client) => {
      await client.query('ALTER TABLE line_items ALTER COLUMN total_price_ore DROP NOT NULL')
      const expenseRow = await client.query<{ id: string }>(
        `SELECT id FROM expenses WHERE household_id = $1 LIMIT 1`,
        [householdId]
      )
      const expenseId = expenseRow.rows[0]!.id
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO line_items (expense_id, description, quantity, unit_price_ore, total_price_ore, is_personal)
         VALUES ($1, 'Pre-migration row', 5, 777, NULL, false)
         RETURNING id`,
        [expenseId]
      )
      const lineItemId = inserted.rows[0]!.id

      await client.query(
        `UPDATE line_items SET total_price_ore = unit_price_ore * quantity WHERE total_price_ore IS NULL AND id = $1`,
        [lineItemId]
      )
      await client.query('ALTER TABLE line_items ALTER COLUMN total_price_ore SET NOT NULL')

      const backfilled = await client.query<{ total_price_ore: number }>(
        'SELECT total_price_ore FROM line_items WHERE id = $1',
        [lineItemId]
      )
      expect(backfilled.rows[0]!.total_price_ore).toBe(5 * 777)

      // Clean up: this row isn't part of any other assertion's fixture data.
      await client.query('DELETE FROM line_items WHERE id = $1', [lineItemId])
    })
  })

  it('leaves expenses.total_amount_ore equal to the sum of non-personal total_price_ore', async () => {
    const rows = await db.query<{ id: string; total_amount_ore: number }>(
      `SELECT id, total_amount_ore FROM expenses WHERE household_id = $1`,
      [householdId]
    )
    for (const expense of rows.rows) {
      const sum = await db.query<{ total: string }>(
        `SELECT COALESCE(SUM(total_price_ore), 0)::bigint as total FROM line_items WHERE expense_id = $1 AND is_personal = false`,
        [expense.id]
      )
      expect(Number(expense.total_amount_ore)).toBe(Number(sum.rows[0]!.total))
    }
  })
})
