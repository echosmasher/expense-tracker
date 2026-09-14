// Ticket 16 (spec 005): the trip dashboard — User Story 3. Covers the empty
// state, the per-currency breakdown, the pending-draft count, and SC-007:
// the provisional balance the summary shows matches the settlement
// subsequently produced from the same confirmed expenses, because both are
// built through the same function (services/projectSettlement.ts).
import { describe, it, expect, beforeAll, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import sharp from 'sharp'
import { randomUUID } from 'node:crypto'

vi.mock('../src/services/email.js', () => ({
  sendInviteEmail: vi.fn(async () => {}),
  sendSettlementReadyEmail: vi.fn(async () => {}),
}))
vi.mock('../src/services/categorizer.js', () => ({
  categorizeWithAI: vi.fn(async () => []),
}))

const parseReceiptMock = vi.fn()
vi.mock('../src/services/receiptParser.js', () => ({
  parseReceipt: (...args: unknown[]) => parseReceiptMock(...args),
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

async function createActiveHousehold(admin: TestUser, member: TestUser, name: string): Promise<string> {
  const createRes = await request(app)
    .post('/api/v1/households')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ name, allocationKey: [{ userId: admin.id, shareBp: 5_000 }, { userId: member.id, shareBp: 5_000 }] })
  expect(createRes.status).toBe(201)
  const householdId: string = createRes.body.id
  await db.query(
    "INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'member')",
    [householdId, member.id]
  )
  await db.query("UPDATE households SET status = 'active' WHERE id = $1", [householdId])
  return householdId
}

function testImage() {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } }).jpeg().toBuffer()
}

async function uploadReceipt(token: string, projectId: string) {
  const image = await testImage()
  return request(app)
    .post(`/api/v1/projects/${projectId}/expenses/from-receipt`)
    .set('Authorization', `Bearer ${token}`)
    .field('captureId', randomUUID())
    .attach('receipt', image, { filename: 'receipt.jpg', contentType: 'image/jpeg' })
}

let admin: TestUser
let member: TestUser
let householdId: string

beforeAll(async () => {
  admin = await registerUser('Summary Admin', 'summary-admin@example.com')
  member = await registerUser('Summary Member', 'summary-member@example.com')
  householdId = await createActiveHousehold(admin, member, 'Summary Household')
})

async function createProject(): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/households/${householdId}/projects`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({
      name: 'Interrail trip',
      memberIds: [admin.id, member.id],
      allocationKey: [{ userId: admin.id, shareBp: 5_000 }, { userId: member.id, shareBp: 5_000 }],
    })
  expect(res.status).toBe(201)
  return res.body.id
}

describe('project summary (trip dashboard, ticket 16)', () => {
  it('shows an empty state rather than a zeroed balance sheet when there are no expenses', async () => {
    const projectId = await createProject()

    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/summary`)
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    expect(res.body.homeCurrencyTotalOre).toBe(0)
    expect(res.body.currencies).toEqual([])
    expect(res.body.draftCount).toBe(0)
    expect(res.body.provisionalBalance).toBeNull()
  })

  it('breaks totals down per currency, counts drafts separately, and matches the settlement triggered right after (SC-007)', async () => {
    const projectId = await createProject()

    // A pending draft — counted separately, excluded from every total.
    parseReceiptMock.mockResolvedValueOnce({
      store: 'Some shop', date: '2026-07-10', detectedCardLastFour: null, currency: null,
      items: [{ description: 'Souvenir', quantity: 1, unitPriceOre: 5000, confidenceLow: false }],
    })
    const draftRes = await uploadReceipt(admin.token, projectId)
    expect(draftRes.status).toBe(201)
    expect(draftRes.body.status).toBe('pending_review')

    // A home-currency confirmed expense, paid by admin.
    const nokExpenseRes = await request(app)
      .post(`/api/v1/projects/${projectId}/expenses`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        store: 'Train station kiosk',
        date: '2026-07-11',
        purchasedBy: admin.id,
        lineItems: [{ description: 'Snacks', quantity: 1, unitPriceOre: 8_000, isPersonal: false }],
      })
    expect(nokExpenseRes.status).toBe(201)

    // A foreign-currency confirmed expense, paid by member: draft → set
    // currency with a manual rate → add line item → confirm.
    parseReceiptMock.mockResolvedValueOnce({
      store: 'Café de Paris', date: '2026-07-12', detectedCardLastFour: null, currency: null,
      items: [],
    })
    const foreignDraftRes = await uploadReceipt(member.token, projectId)
    expect(foreignDraftRes.status).toBe(201)
    const foreignExpenseId: string = foreignDraftRes.body.id

    const setCurrencyRes = await request(app)
      .patch(`/api/v1/projects/${projectId}/expenses/${foreignExpenseId}`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ purchasedBy: member.id, currency: 'EUR', rateScaled: 11_654_300 })
    expect(setCurrencyRes.status).toBe(200)

    const addLineRes = await request(app)
      .post(`/api/v1/projects/${projectId}/expenses/${foreignExpenseId}/line-items`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ description: 'Dinner', quantity: 1, originalUnitPriceMinor: 1_000, isPersonal: false })
    expect(addLineRes.status).toBe(201)
    const foreignHomeOre: number = addLineRes.body.totalAmountOre

    const confirmForeignRes = await request(app)
      .post(`/api/v1/projects/${projectId}/expenses/${foreignExpenseId}/confirm`)
      .set('Authorization', `Bearer ${member.token}`)
    expect(confirmForeignRes.status).toBe(200)

    // ── Summary ──────────────────────────────────────────────────────────
    const summaryRes = await request(app)
      .get(`/api/v1/projects/${projectId}/summary`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(summaryRes.status).toBe(200)

    expect(summaryRes.body.draftCount).toBe(1)
    expect(summaryRes.body.homeCurrencyTotalOre).toBe(8_000 + foreignHomeOre)

    const nok = summaryRes.body.currencies.find((c: { currency: string }) => c.currency === 'NOK')
    const eur = summaryRes.body.currencies.find((c: { currency: string }) => c.currency === 'EUR')
    expect(nok).toEqual({ currency: 'NOK', originalSumMinor: 8_000, homeSumOre: 8_000, count: 1 })
    expect(eur).toEqual({ currency: 'EUR', originalSumMinor: 1_000, homeSumOre: foreignHomeOre, count: 1 })

    expect(summaryRes.body.provisionalBalance).not.toBeNull()
    const provisional = summaryRes.body.provisionalBalance

    // ── Trigger the settlement and compare ──────────────────────────────
    const finishRes = await request(app)
      .post(`/api/v1/projects/${projectId}/finish`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(finishRes.status).toBe(200)

    // No GET route exposes a project settlement's persisted figures directly
    // (only the household-scoped settlement route, which project settlements
    // — no household_id — don't match), so read the rows the finish route
    // just inserted.
    const settlementId: string = finishRes.body.id
    const balanceRows = await db.query<{ user_id: string; balance_ore: number }>(
      'SELECT user_id, balance_ore FROM settlement_balances WHERE settlement_id = $1',
      [settlementId]
    )
    const txRows = await db.query<{ from_user_id: string; to_user_id: string; amount_ore: number }>(
      'SELECT from_user_id, to_user_id, amount_ore FROM settlement_transactions WHERE settlement_id = $1',
      [settlementId]
    )

    const sortByUser = <T extends { userId: string }>(rows: T[]) => [...rows].sort((a, b) => a.userId.localeCompare(b.userId))

    expect(
      sortByUser(balanceRows.rows.map((b) => ({ userId: b.user_id, amountOre: Number(b.balance_ore) })))
    ).toEqual(sortByUser(provisional.balances).map((b: { userId: string; amountOre: number }) => ({ userId: b.userId, amountOre: b.amountOre })))

    expect(txRows.rows.map((t) => ({
      fromUserId: t.from_user_id, toUserId: t.to_user_id, amountOre: Number(t.amount_ore),
    }))).toEqual(provisional.transactions.map((t: { fromUserId: string; toUserId: string; amountOre: number }) => ({
      fromUserId: t.fromUserId, toUserId: t.toUserId, amountOre: t.amountOre,
    })))
  })
})
