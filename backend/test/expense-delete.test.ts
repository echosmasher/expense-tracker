// Deleting a draft or confirmed expense (household and project): the row and
// its line items go, its receipt image is removed from storage, and anything
// settled or captured in a settlement snapshot is refused (spec 003 — a
// snapshot's figures must never drift from the expenses it was built from).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'

vi.mock('../src/services/email.js', () => ({
  sendInviteEmail: vi.fn(async () => {}),
  sendSettlementReadyEmail: vi.fn(async () => {}),
}))

const deleteObject = vi.hoisted(() => vi.fn(async (_key: string) => {}))
vi.mock('../src/storage/minio.js', () => ({
  ensureBucket: vi.fn(async () => {}),
  uploadFile: vi.fn(async (key: string) => key),
  getObject: vi.fn(),
  deleteObject,
}))

import { app } from '../src/app.js'
import { db } from '../src/db/client.js'

interface TestUser {
  id: string
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
  return { id: insert.rows[0]!.id, token: login.body.accessToken }
}

let admin: TestUser
let householdId: string
let projectId: string

const as = (req: request.Test) => req.set('Authorization', `Bearer ${admin.token}`)

async function createExpense(opts: { confirm: boolean; receiptImageKey?: string; total?: number }) {
  const createRes = await as(request(app).post(`/api/v1/households/${householdId}/expenses`)).send({
    store: 'Rema 1000',
    date: '2026-07-10',
    purchasedBy: admin.id,
    ...(opts.receiptImageKey ? { receiptImageKey: opts.receiptImageKey } : {}),
    lineItems: [
      { description: 'Melk', quantity: 1, unitPriceOre: opts.total ?? 2500 },
      { description: 'Brød', quantity: 2, unitPriceOre: 3000 },
    ],
  })
  expect(createRes.status).toBe(201)
  const expenseId: string = createRes.body.id
  if (opts.confirm) {
    const confirmRes = await as(
      request(app).post(`/api/v1/households/${householdId}/expenses/${expenseId}/confirm`)
    )
    expect(confirmRes.status).toBe(200)
  }
  return expenseId
}

beforeAll(async () => {
  admin = await registerUser('Delete Admin', 'expense-delete-admin@example.com')
  const createRes = await request(app)
    .post('/api/v1/households')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ name: 'Delete Household', allocationKey: [{ userId: admin.id, shareBp: 10_000 }] })
  expect(createRes.status).toBe(201)
  householdId = createRes.body.id
  await db.query("UPDATE households SET status = 'active' WHERE id = $1", [householdId])

  const projectRes = await as(request(app).post(`/api/v1/households/${householdId}/projects`)).send({
    name: 'Delete Trip',
    memberIds: [admin.id],
    allocationKey: [{ userId: admin.id, shareBp: 10_000 }],
  })
  expect(projectRes.status).toBe(201)
  projectId = projectRes.body.id
})

beforeEach(() => {
  deleteObject.mockClear()
})

describe('DELETE /households/:id/expenses/:id', () => {
  it('deletes a draft expense', async () => {
    const expenseId = await createExpense({ confirm: false })
    const before = await db.query<{ status: string }>('SELECT status FROM expenses WHERE id = $1', [expenseId])
    expect(before.rows[0]?.status).toBe('pending_review')

    const res = await as(request(app).delete(`/api/v1/households/${householdId}/expenses/${expenseId}`))
    expect(res.status).toBe(204)
    expect((await db.query('SELECT 1 FROM expenses WHERE id = $1', [expenseId])).rows).toHaveLength(0)
  })

  it('deletes a confirmed expense together with its line items', async () => {
    const expenseId = await createExpense({ confirm: true })

    const res = await as(request(app).delete(`/api/v1/households/${householdId}/expenses/${expenseId}`))
    expect(res.status).toBe(204)

    expect((await db.query('SELECT 1 FROM expenses WHERE id = $1', [expenseId])).rows).toHaveLength(0)
    expect((await db.query('SELECT 1 FROM line_items WHERE expense_id = $1', [expenseId])).rows).toHaveLength(0)

    const get = await as(request(app).get(`/api/v1/households/${householdId}/expenses/${expenseId}`))
    expect(get.status).toBe(404)
  })

  it('removes the receipt image from storage', async () => {
    const expenseId = await createExpense({ confirm: true, receiptImageKey: 'receipts/del-test-1.jpg' })

    const res = await as(request(app).delete(`/api/v1/households/${householdId}/expenses/${expenseId}`))
    expect(res.status).toBe(204)
    expect(deleteObject).toHaveBeenCalledWith('receipts/del-test-1.jpg')
  })

  it('still succeeds when the storage cleanup fails', async () => {
    const expenseId = await createExpense({ confirm: true, receiptImageKey: 'receipts/del-test-2.jpg' })
    deleteObject.mockRejectedValueOnce(new Error('storage down'))

    const res = await as(request(app).delete(`/api/v1/households/${householdId}/expenses/${expenseId}`))
    expect(res.status).toBe(204)
    expect((await db.query('SELECT 1 FROM expenses WHERE id = $1', [expenseId])).rows).toHaveLength(0)
  })

  it('does not touch storage for an expense without a receipt', async () => {
    const expenseId = await createExpense({ confirm: false })
    const res = await as(request(app).delete(`/api/v1/households/${householdId}/expenses/${expenseId}`))
    expect(res.status).toBe(204)
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown expense', async () => {
    const res = await as(
      request(app).delete(`/api/v1/households/${householdId}/expenses/00000000-0000-0000-0000-000000000000`)
    )
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('EXPENSE_NOT_FOUND')
  })

  it('is no longer counted in the expense list', async () => {
    const keep = await createExpense({ confirm: true })
    const drop = await createExpense({ confirm: true })
    await as(request(app).delete(`/api/v1/households/${householdId}/expenses/${drop}`))

    const list = await as(request(app).get(`/api/v1/households/${householdId}/expenses`))
    const ids = list.body.expenses.map((e: { id: string }) => e.id)
    expect(ids).toContain(keep)
    expect(ids).not.toContain(drop)
  })
})

describe('DELETE /households/:id/expenses/:id — settlement protection', () => {
  it('refuses an expense in an open settlement, names it, and leaves everything intact', async () => {
    const expenseId = await createExpense({ confirm: true, receiptImageKey: 'receipts/del-test-3.jpg' })
    const settleRes = await as(request(app).post(`/api/v1/households/${householdId}/settlements`))
    expect(settleRes.status).toBe(201)

    const res = await as(request(app).delete(`/api/v1/households/${householdId}/expenses/${expenseId}`))
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('IN_OPEN_SETTLEMENT')
    expect(res.body.error.message).toContain(settleRes.body.id)

    expect((await db.query('SELECT 1 FROM expenses WHERE id = $1', [expenseId])).rows).toHaveLength(1)
    expect((await db.query('SELECT 1 FROM line_items WHERE expense_id = $1', [expenseId])).rows).toHaveLength(2)
    expect(deleteObject).not.toHaveBeenCalled()

    // Complete it so it does not block the other tests in this file.
    await db.query("UPDATE settlements SET status = 'completed' WHERE id = $1", [settleRes.body.id])
    await db.query(
      `UPDATE expenses SET status = 'settled'
       WHERE id IN (SELECT expense_id FROM settlement_expenses WHERE settlement_id = $1)`,
      [settleRes.body.id]
    )

    const settled = await as(request(app).delete(`/api/v1/households/${householdId}/expenses/${expenseId}`))
    expect(settled.status).toBe(409)
    expect(settled.body.error.code).toBe('EXPENSE_SETTLED')
    expect((await db.query('SELECT 1 FROM expenses WHERE id = $1', [expenseId])).rows).toHaveLength(1)
  })

  it('refuses an expense captured in a completed settlement even if its status was not flipped', async () => {
    const expenseId = await createExpense({ confirm: true })
    const settleRes = await as(request(app).post(`/api/v1/households/${householdId}/settlements`))
    expect(settleRes.status).toBe(201)
    await db.query("UPDATE settlements SET status = 'completed' WHERE id = $1", [settleRes.body.id])

    const res = await as(request(app).delete(`/api/v1/households/${householdId}/expenses/${expenseId}`))
    expect(res.status).toBe(409)
    expect((await db.query('SELECT 1 FROM expenses WHERE id = $1', [expenseId])).rows).toHaveLength(1)
  })
})

describe('DELETE /projects/:id/expenses/:id', () => {
  // POST /projects/:id/expenses records the expense already confirmed.
  async function createProjectExpense(receiptImageKey?: string) {
    const createRes = await as(request(app).post(`/api/v1/projects/${projectId}/expenses`)).send({
      store: 'Trip Cafe',
      date: '2026-07-11',
      purchasedBy: admin.id,
      ...(receiptImageKey ? { receiptImageKey } : {}),
      lineItems: [{ description: 'Lunch', quantity: 1, unitPriceOre: 12_000 }],
    })
    expect(createRes.status).toBe(201)
    expect(createRes.body.status).toBe('confirmed')
    return createRes.body.id as string
  }

  it('deletes a confirmed project expense, its line items and its receipt image', async () => {
    const expenseId = await createProjectExpense('receipts/del-test-4.jpg')

    const res = await as(request(app).delete(`/api/v1/projects/${projectId}/expenses/${expenseId}`))
    expect(res.status).toBe(204)
    expect((await db.query('SELECT 1 FROM expenses WHERE id = $1', [expenseId])).rows).toHaveLength(0)
    expect((await db.query('SELECT 1 FROM line_items WHERE expense_id = $1', [expenseId])).rows).toHaveLength(0)
    expect(deleteObject).toHaveBeenCalledWith('receipts/del-test-4.jpg')
  })

  it('deletes a draft project expense', async () => {
    const expenseId = await createProjectExpense()
    await db.query("UPDATE expenses SET status = 'pending_review' WHERE id = $1", [expenseId])
    const res = await as(request(app).delete(`/api/v1/projects/${projectId}/expenses/${expenseId}`))
    expect(res.status).toBe(204)
  })

  it('cannot delete a household expense through the project route', async () => {
    const householdExpense = await createExpense({ confirm: true })
    const res = await as(request(app).delete(`/api/v1/projects/${projectId}/expenses/${householdExpense}`))
    expect(res.status).toBe(404)
    expect((await db.query('SELECT 1 FROM expenses WHERE id = $1', [householdExpense])).rows).toHaveLength(1)
  })

  it('refuses a settled project expense', async () => {
    const expenseId = await createProjectExpense()
    await db.query("UPDATE expenses SET status = 'settled' WHERE id = $1", [expenseId])

    const res = await as(request(app).delete(`/api/v1/projects/${projectId}/expenses/${expenseId}`))
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('EXPENSE_SETTLED')
    expect((await db.query('SELECT 1 FROM expenses WHERE id = $1', [expenseId])).rows).toHaveLength(1)
  })
})
