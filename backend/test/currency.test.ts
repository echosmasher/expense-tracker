// Ticket 13 (spec 005): currency as a first-class property of an expense.
// Covers the manual hand-entered foreign-currency expense route, the
// migration's additive/byte-identical guarantees for existing (home-currency)
// data, and that expense/household responses carry the new currency fields.
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

let admin: TestUser
let householdId: string

beforeAll(async () => {
  admin = await registerUser('Currency Admin', 'currency-admin@example.com')
  householdId = await createActiveHousehold(admin, 'Currency Household')
})

describe('household home currency', () => {
  it('is NOK and exposed on every household response', async () => {
    const res = await request(app)
      .get(`/api/v1/households/${householdId}`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    expect(res.body.homeCurrency).toBe('NOK')
  })
})

describe('POST /households/:id/expenses — home currency (unchanged)', () => {
  it('creates an expense with no currency metadata', async () => {
    const res = await request(app)
      .post(`/api/v1/households/${householdId}/expenses`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        store: 'Rema 1000',
        date: '2026-06-01',
        purchasedBy: admin.id,
        lineItems: [{ description: 'Melk', quantity: 2, unitPriceOre: 2500 }],
      })
    expect(res.status).toBe(201)
    expect(res.body.currency).toBe('NOK')
    expect(res.body.originalTotalMinor).toBeNull()
    expect(res.body.rateScaled).toBeNull()
    expect(res.body.rateSource).toBeNull()
    expect(res.body.lineItems[0].originalUnitPriceMinor).toBeNull()
    expect(res.body.totalAmountOre).toBe(5000)
  })
})

describe('POST /households/:id/expenses — hand-entered foreign currency', () => {
  it('accepts a currency and explicit rate, deriving home amounts per line and in total', async () => {
    // 12.50 EUR at 11.6543 → 14568 øre (worked example from the plan).
    const res = await request(app)
      .post(`/api/v1/households/${householdId}/expenses`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        store: 'Café de Paris',
        date: '2026-06-02',
        purchasedBy: admin.id,
        currency: 'EUR',
        rateScaled: 11_654_300,
        lineItems: [{ description: 'Lunch', quantity: 1, originalUnitPriceMinor: 1250 }],
      })

    expect(res.status).toBe(201)
    expect(res.body.currency).toBe('EUR')
    expect(res.body.originalTotalMinor).toBe(1250)
    expect(res.body.rateScaled).toBe('11654300')
    expect(res.body.rateSource).toBe('manual')
    expect(res.body.rateCapturedAt).not.toBeNull()

    const line = res.body.lineItems[0]
    expect(line.originalUnitPriceMinor).toBe(1250)
    expect(line.originalTotalMinor).toBe(1250)
    expect(line.unitPriceOre).toBe(14568)

    expect(res.body.totalAmountOre).toBe(14568)
  })

  it('sums multiple foreign line items to the same total as summing per-line home amounts (SC-002)', async () => {
    const res = await request(app)
      .post(`/api/v1/households/${householdId}/expenses`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        store: 'Multi-line foreign store',
        date: '2026-06-03',
        purchasedBy: admin.id,
        currency: 'USD',
        rateScaled: 10_500_000, // 10.5 NOK/USD
        lineItems: [
          { description: 'Item A', quantity: 2, originalUnitPriceMinor: 500 },
          { description: 'Item B', quantity: 1, originalUnitPriceMinor: 1_000, isPersonal: true },
        ],
      })
    expect(res.status).toBe(201)

    // Ground truth: total_price_ore must equal the direct conversion of the
    // line's original TOTAL — never a rounded per-unit conversion multiplied
    // by quantity, which can drift (see the dedicated regression test below).
    const expected = res.body.lineItems
      .filter((li: { isPersonal: boolean }) => !li.isPersonal)
      .reduce((sum: number, li: { originalTotalMinor: number }) => sum + homeOre(li.originalTotalMinor, 10_500_000n, 2), 0)
    expect(res.body.totalAmountOre).toBe(expected)

    const dbRow = await db.query<{ total_price_ore: number; original_total_minor: string }>(
      `SELECT total_price_ore, original_total_minor FROM line_items WHERE expense_id = $1 ORDER BY total_price_ore`,
      [res.body.id]
    )
    for (const row of dbRow.rows) {
      expect(row.total_price_ore).toBe(homeOre(Number(row.original_total_minor), 10_500_000n, 2))
    }
  })

  it('converts the line total directly rather than a rounded unit price × quantity (regression)', async () => {
    // originalUnitPriceMinor=1, quantity=7, rate=1.65 NOK/unit: per-unit
    // conversion rounds to 2 øre (2×7=14), but converting the total directly
    // gives 12 øre — the value the money model requires.
    const res = await request(app)
      .post(`/api/v1/households/${householdId}/expenses`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        store: 'Rounding drift regression',
        date: '2026-06-04',
        purchasedBy: admin.id,
        currency: 'EUR',
        rateScaled: 1_650_000,
        lineItems: [{ description: 'Seven units', quantity: 7, originalUnitPriceMinor: 1 }],
      })
    expect(res.status).toBe(201)
    expect(res.body.lineItems[0].unitPriceOre).toBe(2) // display-only per-unit conversion
    expect(res.body.lineItems[0].unitPriceOre * 7).toBe(14) // what the buggy formula would have stored
    expect(res.body.totalAmountOre).toBe(12) // what the money model requires
  })

  it('rejects a foreign currency with no rateScaled', async () => {
    const res = await request(app)
      .post(`/api/v1/households/${householdId}/expenses`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        purchasedBy: admin.id,
        currency: 'EUR',
        lineItems: [{ description: 'Lunch', quantity: 1, originalUnitPriceMinor: 1250 }],
      })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('RATE_REQUIRED')
  })

  it('rejects an unknown currency', async () => {
    const res = await request(app)
      .post(`/api/v1/households/${householdId}/expenses`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        purchasedBy: admin.id,
        currency: 'ZZZ',
        rateScaled: 1_000_000,
        lineItems: [{ description: 'Lunch', quantity: 1, originalUnitPriceMinor: 1250 }],
      })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('UNKNOWN_CURRENCY')
  })

  it('rejects a foreign-currency line item missing originalUnitPriceMinor', async () => {
    const res = await request(app)
      .post(`/api/v1/households/${householdId}/expenses`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        purchasedBy: admin.id,
        currency: 'EUR',
        rateScaled: 11_654_300,
        lineItems: [{ description: 'Lunch', quantity: 1, unitPriceOre: 1250 }],
      })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('NON_INTEGER_AMOUNT')
  })
})

describe('migration 011 additive guarantees', () => {
  it('every expense created before this feature (fixture: home-currency rows) reads as NOK with no rate metadata', async () => {
    const rows = await db.query<{
      currency: string
      original_total_minor: string | null
      rate_scaled: string | null
      rate_source: string | null
    }>(
      `SELECT currency, original_total_minor, rate_scaled, rate_source
       FROM expenses WHERE household_id = $1 AND currency = 'NOK'`,
      [householdId]
    )
    expect(rows.rows.length).toBeGreaterThan(0)
    for (const row of rows.rows) {
      expect(row.original_total_minor).toBeNull()
      expect(row.rate_scaled).toBeNull()
      expect(row.rate_source).toBeNull()
    }
  })

  it('the currency/rate check constraint rejects a foreign row with no rate_source', async () => {
    await expect(
      db.query(
        `INSERT INTO expenses (household_id, purchased_by, expense_date, total_amount_ore, status, currency)
         VALUES ($1, $2, '2026-06-01', 0, 'pending_review', 'EUR')`,
        [householdId, admin.id]
      )
    ).rejects.toThrow()
  })
})
