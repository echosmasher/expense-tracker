// Ticket 15 (spec 005): correcting a foreign expense's rate after the fact —
// User Story 2. Covers both correction paths (a direct new rate, and the
// actual home-currency amount charged, from which the rate is derived and
// the rounding residual assigned per plan.md), and the settled / open-
// settlement rejection paths pinned by SC-005.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import { homeOre } from '@expense-tracker/shared'

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

async function createConfirmedForeignExpense(
  admin: TestUser,
  householdId: string,
  opts: { date: string; lineItems: Array<{ description: string; quantity: number; originalUnitPriceMinor: number; isPersonal?: boolean }> }
) {
  const createRes = await request(app)
    .post(`/api/v1/households/${householdId}/expenses`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({
      store: 'Café de Paris',
      date: opts.date,
      purchasedBy: admin.id,
      currency: 'EUR',
      rateScaled: 11_654_300, // 1 EUR = 11.6543 NOK
      lineItems: opts.lineItems,
    })
  expect(createRes.status).toBe(201)
  const expenseId: string = createRes.body.id
  const confirmRes = await request(app)
    .post(`/api/v1/households/${householdId}/expenses/${expenseId}/confirm`)
    .set('Authorization', `Bearer ${admin.token}`)
  expect(confirmRes.status).toBe(200)
  return expenseId
}

let admin: TestUser
let householdId: string

beforeAll(async () => {
  admin = await registerUser('Rate Correction Admin', 'rate-correction-admin@example.com')
  householdId = await createActiveHousehold(admin, 'Rate Correction Household')
})

describe('PATCH /households/:id/expenses/:id/rate — direct correction', () => {
  it('reconverts every line from its original amount, sums to the new total, and marks the source corrected', async () => {
    const expenseId = await createConfirmedForeignExpense(admin, householdId, {
      date: '2026-07-01',
      lineItems: [{ description: 'Lunch', quantity: 1, originalUnitPriceMinor: 1250 }],
    })

    const newRate = 12_000_000n // 12.0 NOK/EUR
    const res = await request(app)
      .patch(`/api/v1/households/${householdId}/expenses/${expenseId}/rate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ rateScaled: Number(newRate) })

    expect(res.status).toBe(200)
    expect(res.body.rateScaled).toBe(newRate.toString())
    expect(res.body.rateSource).toBe('corrected')
    expect(res.body.originalTotalMinor).toBe(1250) // original amount untouched

    const expectedTotal = homeOre(1250, newRate, 2)
    expect(res.body.lineItems[0].originalUnitPriceMinor).toBe(1250) // untouched
    expect(res.body.lineItems[0].totalPriceOre).toBe(expectedTotal)
    expect(res.body.totalAmountOre).toBe(expectedTotal)
  })

  it('does not alter any other expense in the same currency and on the same date', async () => {
    const untouchedId = await createConfirmedForeignExpense(admin, householdId, {
      date: '2026-07-02',
      lineItems: [{ description: 'Coffee', quantity: 1, originalUnitPriceMinor: 400 }],
    })
    const correctedId = await createConfirmedForeignExpense(admin, householdId, {
      date: '2026-07-02',
      lineItems: [{ description: 'Dinner', quantity: 1, originalUnitPriceMinor: 3000 }],
    })

    const before = await db.query<{ total_amount_ore: number; rate_scaled: string }>(
      'SELECT total_amount_ore, rate_scaled FROM expenses WHERE id = $1',
      [untouchedId]
    )

    const res = await request(app)
      .patch(`/api/v1/households/${householdId}/expenses/${correctedId}/rate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ rateScaled: 13_000_000 })
    expect(res.status).toBe(200)

    const after = await db.query<{ total_amount_ore: number; rate_scaled: string }>(
      'SELECT total_amount_ore, rate_scaled FROM expenses WHERE id = $1',
      [untouchedId]
    )
    expect(after.rows[0]).toEqual(before.rows[0])
  })
})

describe('PATCH /households/:id/expenses/:id/rate — derived from actual amount charged', () => {
  it('derives and stores the rate, reconverts every line, and assigns the residual to the largest non-personal line', async () => {
    const expenseId = await createConfirmedForeignExpense(admin, householdId, {
      date: '2026-07-03',
      lineItems: [
        { description: 'Small item', quantity: 1, originalUnitPriceMinor: 500 },
        { description: 'Large item', quantity: 1, originalUnitPriceMinor: 5_000 },
        { description: 'Personal souvenir', quantity: 1, originalUnitPriceMinor: 1_000, isPersonal: true },
      ],
    })

    const actualHomeTotalOre = 79_999 // an odd amount, unlikely to divide evenly
    const res = await request(app)
      .patch(`/api/v1/households/${householdId}/expenses/${expenseId}/rate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ actualHomeTotalOre })

    expect(res.status).toBe(200)
    expect(res.body.rateSource).toBe('derived')
    expect(res.body.rateScaled).not.toBeNull()

    // Invariant: sum of ALL lines equals the entered amount exactly.
    const sumAllLines = res.body.lineItems.reduce((sum: number, li: { totalPriceOre: number }) => sum + li.totalPriceOre, 0)
    expect(sumAllLines).toBe(actualHomeTotalOre)

    // Invariant: the expense total equals the sum of non-personal lines.
    const sumNonPersonal = res.body.lineItems
      .filter((li: { isPersonal: boolean }) => !li.isPersonal)
      .reduce((sum: number, li: { totalPriceOre: number }) => sum + li.totalPriceOre, 0)
    expect(res.body.totalAmountOre).toBe(sumNonPersonal)

    // The residual landed on the largest non-personal line ("Large item").
    const largeLine = res.body.lineItems.find((li: { description: string }) => li.description === 'Large item')
    const smallLine = res.body.lineItems.find((li: { description: string }) => li.description === 'Small item')
    const personalLine = res.body.lineItems.find((li: { description: string }) => li.description === 'Personal souvenir')
    expect(largeLine.totalPriceOre).toBeGreaterThan(smallLine.totalPriceOre)

    // Original amounts are untouched by either path.
    expect(largeLine.originalUnitPriceMinor).toBe(5_000)
    expect(smallLine.originalUnitPriceMinor).toBe(500)
    expect(personalLine.originalUnitPriceMinor).toBe(1_000)
  })

  it('assigns the residual to the largest line overall when every line is personal', async () => {
    const expenseId = await createConfirmedForeignExpense(admin, householdId, {
      date: '2026-07-04',
      lineItems: [
        { description: 'Personal small', quantity: 1, originalUnitPriceMinor: 200, isPersonal: true },
        { description: 'Personal large', quantity: 1, originalUnitPriceMinor: 2_000, isPersonal: true },
      ],
    })

    const actualHomeTotalOre = 25_567
    const res = await request(app)
      .patch(`/api/v1/households/${householdId}/expenses/${expenseId}/rate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ actualHomeTotalOre })

    expect(res.status).toBe(200)
    const sumAllLines = res.body.lineItems.reduce((sum: number, li: { totalPriceOre: number }) => sum + li.totalPriceOre, 0)
    expect(sumAllLines).toBe(actualHomeTotalOre)
    expect(res.body.totalAmountOre).toBe(0) // all lines personal — nothing household-billable
  })
})

describe('PATCH /households/:id/expenses/:id/rate — rejections (SC-005)', () => {
  it('rejects an expense in the home currency', async () => {
    const createRes = await request(app)
      .post(`/api/v1/households/${householdId}/expenses`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        store: 'Rema 1000',
        date: '2026-07-05',
        purchasedBy: admin.id,
        lineItems: [{ description: 'Melk', quantity: 1, unitPriceOre: 2500 }],
      })
    expect(createRes.status).toBe(201)

    const res = await request(app)
      .patch(`/api/v1/households/${householdId}/expenses/${createRes.body.id}/rate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ rateScaled: 10_000_000 })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('NOT_FOREIGN_CURRENCY')
  })

  it('rejects a settled expense', async () => {
    const expenseId = await createConfirmedForeignExpense(admin, householdId, {
      date: '2026-07-06',
      lineItems: [{ description: 'Lunch', quantity: 1, originalUnitPriceMinor: 1250 }],
    })

    const settleRes = await request(app)
      .post(`/api/v1/households/${householdId}/settlements`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(settleRes.status).toBe(201)

    // Single-member allocation key (100% to admin) closes with zero
    // transactions to mark paid — the settlement auto-closes only once every
    // transaction is paid, so mark it directly to reach 'completed' here.
    await db.query("UPDATE settlements SET status = 'completed' WHERE id = $1", [settleRes.body.id])
    await db.query(
      `UPDATE expenses SET status = 'settled'
       WHERE id IN (SELECT expense_id FROM settlement_expenses WHERE settlement_id = $1)`,
      [settleRes.body.id]
    )

    const check = await db.query<{ status: string }>('SELECT status FROM expenses WHERE id = $1', [expenseId])
    expect(check.rows[0]?.status).toBe('settled')

    const res = await request(app)
      .patch(`/api/v1/households/${householdId}/expenses/${expenseId}/rate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ rateScaled: 10_000_000 })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('EXPENSE_SETTLED')
  })

  it('rejects an expense in an open settlement, naming that settlement, and leaves it unmodified', async () => {
    const expenseId = await createConfirmedForeignExpense(admin, householdId, {
      date: '2026-07-07',
      lineItems: [{ description: 'Lunch', quantity: 1, originalUnitPriceMinor: 1250 }],
    })

    const settleRes = await request(app)
      .post(`/api/v1/households/${householdId}/settlements`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(settleRes.status).toBe(201)
    expect(settleRes.body.status).toBe('open')

    const before = await db.query<{ rate_scaled: string; total_amount_ore: number }>(
      'SELECT rate_scaled, total_amount_ore FROM expenses WHERE id = $1',
      [expenseId]
    )

    const res = await request(app)
      .patch(`/api/v1/households/${householdId}/expenses/${expenseId}/rate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ rateScaled: 10_000_000 })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('IN_OPEN_SETTLEMENT')
    expect(res.body.error.message).toContain(settleRes.body.id)

    // The client can see this without hitting the 409, and withholds
    // "Correct rate" accordingly (spec 005 US2 scenario 5).
    const getRes = await request(app)
      .get(`/api/v1/households/${householdId}/expenses/${expenseId}`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(getRes.status).toBe(200)
    expect(getRes.body.openSettlementId).toBe(settleRes.body.id)

    const after = await db.query<{ rate_scaled: string; total_amount_ore: number }>(
      'SELECT rate_scaled, total_amount_ore FROM expenses WHERE id = $1',
      [expenseId]
    )
    expect(after.rows[0]).toEqual(before.rows[0])
  })

  it('rejects a body with neither or both of rateScaled and actualHomeTotalOre', async () => {
    const expenseId = await createConfirmedForeignExpense(admin, householdId, {
      date: '2026-07-08',
      lineItems: [{ description: 'Lunch', quantity: 1, originalUnitPriceMinor: 1250 }],
    })

    const neither = await request(app)
      .patch(`/api/v1/households/${householdId}/expenses/${expenseId}/rate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({})
    expect(neither.status).toBe(400)

    const both = await request(app)
      .patch(`/api/v1/households/${householdId}/expenses/${expenseId}/rate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ rateScaled: 10_000_000, actualHomeTotalOre: 5000 })
    expect(both.status).toBe(400)
  })
})
