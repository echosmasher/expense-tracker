// Negative authorization tests: a member of household B must not be able to
// read or mutate anything belonging to household A — via the obvious routes
// (wrong householdId in the URL) and via ID-stuffing (own householdId in the
// URL but a foreign resource ID).
//
// Fixture: two fully active two-member households, each with an expense, an
// open settlement, and a project. "intruder" is the admin of household B.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import sharp from 'sharp'
import { randomUUID } from 'node:crypto'

// Email goes out on settlement creation; never hit the network from tests.
vi.mock('../src/services/email.js', () => ({
  sendInviteEmail: vi.fn(async () => {}),
  sendSettlementReadyEmail: vi.fn(async () => {}),
}))

// from-receipt calls OpenAI twice (parse, categorize); never hit the network
// from tests — stub both to a deterministic result.
vi.mock('../src/services/receiptParser.js', () => ({
  parseReceipt: vi.fn(async () => ({
    store: 'Test Receipt Store',
    date: '2026-06-01',
    detectedCardLastFour: null,
    items: [{ description: 'Bread', quantity: 1, unitPriceOre: 3000, confidenceLow: false }],
  })),
}))
vi.mock('../src/services/categorizer.js', () => ({
  categorizeWithAI: vi.fn(async (items: Array<{ index: number }>) =>
    items.map((i) => ({ index: i.index, category: 'Groceries', confidence: 'high' as const }))
  ),
}))

import { app } from '../src/app.js'
import { db } from '../src/db/client.js'

/** A minimal, real, decodable JPEG — sanitizeImage rejects anything else. */
async function fakeReceiptImage(): Promise<Buffer> {
  return sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } }).jpeg().toBuffer()
}

interface TestUser {
  id: string
  email: string
  token: string
}

/** Accounts are invite-only; tests create users directly (the way the host-side
 * create-user CLI does) rather than through a network route. */
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

/** Create a household via the API, then add a second member directly in the
 * DB (the invite flow needs email round-trips) and activate it. */
async function createActiveHousehold(admin: TestUser, member: TestUser, name: string) {
  const createRes = await request(app)
    .post('/api/v1/households')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ name, allocationKey: [{ userId: admin.id, shareBp: 10_000 }] })
  expect(createRes.status).toBe(201)
  const householdId: string = createRes.body.id

  await db.query(
    "INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'member')",
    [householdId, member.id]
  )
  await db.query("UPDATE households SET status = 'active' WHERE id = $1", [householdId])

  const patchRes = await request(app)
    .patch(`/api/v1/households/${householdId}`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({
      newAllocationKey: [
        { userId: admin.id, shareBp: 5_000 },
        { userId: member.id, shareBp: 5_000 },
      ],
    })
  expect(patchRes.status).toBe(200)

  return householdId
}

async function createConfirmedExpense(user: TestUser, householdId: string) {
  const createRes = await request(app)
    .post(`/api/v1/households/${householdId}/expenses`)
    .set('Authorization', `Bearer ${user.token}`)
    .send({
      store: 'Test Store',
      date: '2026-06-01',
      purchasedBy: user.id,
      lineItems: [{ description: 'Milk', quantity: 1, unitPriceOre: 10_000 }],
    })
  expect(createRes.status).toBe(201)
  const expenseId: string = createRes.body.id
  const lineItemId: string = createRes.body.lineItems[0].id

  const confirmRes = await request(app)
    .post(`/api/v1/households/${householdId}/expenses/${expenseId}/confirm`)
    .set('Authorization', `Bearer ${user.token}`)
  expect(confirmRes.status).toBe(200)

  return { expenseId, lineItemId }
}

// Fixture state shared across all tests (read-only after beforeAll).
let alice: TestUser // admin of household A
let anna: TestUser // member of household A
let bob: TestUser // admin of household B — "the intruder"
let householdA: string
let householdB: string
let expenseA: string
let lineItemA: string
let settlementA: string
let transactionA: string
let projectA: string
let projectExpenseA: string
let categoryA: string
let cardA: string
let draftA: string // pending_review household expense, one line item
let draftLineItemA: string
let projectB: string // Bob's own project, used for ID-stuffing tests
let projectDraftA: string // pending_review project expense, one line item (via from-receipt)

beforeAll(async () => {
  // Start from an empty test database.
  const tables = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_migrations'"
  )
  await db.query(
    `TRUNCATE TABLE ${tables.rows.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`
  )

  alice = await registerUser('Alice', 'alice@a.example')
  anna = await registerUser('Anna', 'anna@a.example')
  bob = await registerUser('Bob', 'bob@b.example')
  const ben = await registerUser('Ben', 'ben@b.example')

  householdA = await createActiveHousehold(alice, anna, 'Household A')
  householdB = await createActiveHousehold(bob, ben, 'Household B')

  const exp = await createConfirmedExpense(alice, householdA)
  expenseA = exp.expenseId
  lineItemA = exp.lineItemId

  // Open settlement in household A (admin-only) with one transaction Anna → Alice.
  const settleRes = await request(app)
    .post(`/api/v1/households/${householdA}/settlements`)
    .set('Authorization', `Bearer ${alice.token}`)
  expect(settleRes.status).toBe(201)
  settlementA = settleRes.body.id
  expect(settleRes.body.transactions.length).toBeGreaterThan(0)
  transactionA = settleRes.body.transactions[0].id

  const projectRes = await request(app)
    .post(`/api/v1/households/${householdA}/projects`)
    .set('Authorization', `Bearer ${alice.token}`)
    .send({
      name: 'Garden shed',
      memberIds: [alice.id, anna.id],
      allocationKey: [
        { userId: alice.id, shareBp: 5_000 },
        { userId: anna.id, shareBp: 5_000 },
      ],
    })
  expect(projectRes.status).toBe(201)
  projectA = projectRes.body.id

  const projectExpenseRes = await request(app)
    .post(`/api/v1/projects/${projectA}/expenses`)
    .set('Authorization', `Bearer ${alice.token}`)
    .send({
      purchasedBy: alice.id,
      lineItems: [{ description: 'Lumber', quantity: 1, unitPriceOre: 5_000 }],
    })
  expect(projectExpenseRes.status).toBe(201)
  projectExpenseA = projectExpenseRes.body.id

  const catRes = await request(app)
    .get(`/api/v1/households/${householdA}/categories`)
    .set('Authorization', `Bearer ${alice.token}`)
  expect(catRes.status).toBe(200)
  categoryA = catRes.body.categories[0].id

  const cardRes = await request(app)
    .post('/api/v1/users/me/cards')
    .set('Authorization', `Bearer ${alice.token}`)
    .send({ lastFour: '4242', label: 'Alice visa' })
  expect(cardRes.status).toBe(201)
  cardA = cardRes.body.id

  // A draft (pending_review) household expense with one line item, for the
  // draft-editing route tests — created but never confirmed.
  const draftRes = await request(app)
    .post(`/api/v1/households/${householdA}/expenses`)
    .set('Authorization', `Bearer ${alice.token}`)
    .send({
      store: 'Draft Store',
      purchasedBy: alice.id,
      lineItems: [{ description: 'Eggs', quantity: 1, unitPriceOre: 4_000 }],
    })
  expect(draftRes.status).toBe(201)
  expect(draftRes.body.status).toBe('pending_review')
  draftA = draftRes.body.id
  draftLineItemA = draftRes.body.lineItems[0].id

  // Bob's own project, for ID-stuffing tests (own project URL, foreign resource id).
  const projectBRes = await request(app)
    .post(`/api/v1/households/${householdB}/projects`)
    .set('Authorization', `Bearer ${bob.token}`)
    .send({ name: 'Bob solo project', memberIds: [bob.id], allocationKey: [{ userId: bob.id, shareBp: 10_000 }] })
  expect(projectBRes.status).toBe(201)
  projectB = projectBRes.body.id

  // A draft project expense, created the same way a scan will: from-receipt.
  const image = await fakeReceiptImage()
  const projectDraftRes = await request(app)
    .post(`/api/v1/projects/${projectA}/expenses/from-receipt`)
    .set('Authorization', `Bearer ${alice.token}`)
    .field('captureId', randomUUID())
    .attach('receipt', image, { filename: 'receipt.jpg', contentType: 'image/jpeg' })
  expect(projectDraftRes.status).toBe(201)
  expect(projectDraftRes.body.status).toBe('pending_review')
  projectDraftA = projectDraftRes.body.id
})

afterAll(async () => {
  await db.end()
})

const asBob = (req: request.Test) => req.set('Authorization', `Bearer ${bob.token}`)

// ─── Sanity: the fixture itself works for legitimate members ─────────────────

describe('sanity: household A members can access household A', () => {
  it('member (non-admin) of A can list A expenses', async () => {
    const res = await request(app)
      .get(`/api/v1/households/${householdA}/expenses`)
      .set('Authorization', `Bearer ${anna.token}`)
    expect(res.status).toBe(200)
    // expenseA (confirmed) + draftA (pending_review, added by the draft-editing fixture).
    expect(res.body.expenses).toHaveLength(2)
    expect(res.body.expenses.map((e: { id: string }) => e.id)).toContain(expenseA)
  })

  it('member of A can read the A expense detail', async () => {
    const res = await request(app)
      .get(`/api/v1/households/${householdA}/expenses/${expenseA}`)
      .set('Authorization', `Bearer ${anna.token}`)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(expenseA)
  })
})

// ─── Unauthenticated requests ─────────────────────────────────────────────────

describe('unauthenticated access', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get(`/api/v1/households/${householdA}/expenses`)
    expect(res.status).toBe(401)
  })

  it('rejects requests with a garbage token', async () => {
    const res = await request(app)
      .get(`/api/v1/households/${householdA}/expenses`)
      .set('Authorization', 'Bearer not-a-real-token')
    expect(res.status).toBe(401)
  })
})

// ─── Household routes ─────────────────────────────────────────────────────────

describe('household isolation: households', () => {
  it('cannot read another household', async () => {
    const res = await asBob(request(app).get(`/api/v1/households/${householdA}`))
    expect(res.status).toBe(403)
  })

  it('cannot update another household', async () => {
    const res = await asBob(
      request(app).patch(`/api/v1/households/${householdA}`).send({ name: 'Hacked' })
    )
    expect(res.status).toBe(403)
  })

  it('cannot invite members into another household', async () => {
    const res = await asBob(
      request(app)
        .post(`/api/v1/households/${householdA}/invites`)
        .send({ email: 'mole@b.example' })
    )
    expect(res.status).toBe(403)
  })

  it('household list only contains own households', async () => {
    const res = await asBob(request(app).get('/api/v1/households'))
    expect(res.status).toBe(200)
    const ids = res.body.map((h: { id: string }) => h.id)
    expect(ids).toContain(householdB)
    expect(ids).not.toContain(householdA)
  })
})

// ─── Expense routes ───────────────────────────────────────────────────────────

describe('household isolation: expenses', () => {
  it('cannot list another household’s expenses', async () => {
    const res = await asBob(request(app).get(`/api/v1/households/${householdA}/expenses`))
    expect(res.status).toBe(403)
  })

  it('cannot create an expense in another household', async () => {
    const res = await asBob(
      request(app)
        .post(`/api/v1/households/${householdA}/expenses`)
        .send({
          purchasedBy: bob.id,
          lineItems: [{ description: 'Sneaky', quantity: 1, unitPriceOre: 100 }],
        })
    )
    expect(res.status).toBe(403)
  })

  it('cannot read another household’s expense detail', async () => {
    const res = await asBob(
      request(app).get(`/api/v1/households/${householdA}/expenses/${expenseA}`)
    )
    expect(res.status).toBe(403)
  })

  it('cannot read a foreign expense through own household URL (ID stuffing)', async () => {
    const res = await asBob(
      request(app).get(`/api/v1/households/${householdB}/expenses/${expenseA}`)
    )
    expect(res.status).toBe(404)
  })

  it('cannot confirm a foreign expense through own household URL', async () => {
    const res = await asBob(
      request(app).post(`/api/v1/households/${householdB}/expenses/${expenseA}/confirm`)
    )
    expect(res.status).toBe(404)
  })

  it('cannot confirm another household’s expense', async () => {
    const res = await asBob(
      request(app).post(`/api/v1/households/${householdA}/expenses/${expenseA}/confirm`)
    )
    expect(res.status).toBe(403)
  })

  it('cannot edit another household’s line item', async () => {
    const res = await asBob(
      request(app)
        .patch(`/api/v1/households/${householdA}/expenses/${expenseA}/line-items/${lineItemA}`)
        .send({ unitPriceOre: 1 })
    )
    expect(res.status).toBe(403)
  })

  it('cannot edit a foreign line item through own household URL', async () => {
    const res = await asBob(
      request(app)
        .patch(`/api/v1/households/${householdB}/expenses/${expenseA}/line-items/${lineItemA}`)
        .send({ unitPriceOre: 1 })
    )
    expect(res.status).toBe(404)
  })

  it('cannot recategorize another household’s line item', async () => {
    const res = await asBob(
      request(app)
        .patch(
          `/api/v1/households/${householdA}/expenses/${expenseA}/line-items/${lineItemA}/category`
        )
        .send({ categoryName: 'Groceries' })
    )
    expect(res.status).toBe(403)
  })

  it('cannot attribute an expense to a user from another household', async () => {
    const res = await asBob(
      request(app)
        .post(`/api/v1/households/${householdB}/expenses`)
        .send({
          purchasedBy: alice.id,
          lineItems: [{ description: 'Misattributed', quantity: 1, unitPriceOre: 100 }],
        })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_PURCHASER')
  })
})

// ─── Settlement routes ────────────────────────────────────────────────────────

describe('household isolation: settlements', () => {
  it('cannot list another household’s settlements', async () => {
    const res = await asBob(request(app).get(`/api/v1/households/${householdA}/settlements`))
    expect(res.status).toBe(403)
  })

  it('cannot trigger a settlement in another household', async () => {
    const res = await asBob(request(app).post(`/api/v1/households/${householdA}/settlements`))
    expect(res.status).toBe(403)
  })

  it('cannot read another household’s settlement detail', async () => {
    const res = await asBob(
      request(app).get(`/api/v1/households/${householdA}/settlements/${settlementA}`)
    )
    expect(res.status).toBe(403)
  })

  it('cannot read a foreign settlement through own household URL (ID stuffing)', async () => {
    const res = await asBob(
      request(app).get(`/api/v1/households/${householdB}/settlements/${settlementA}`)
    )
    expect(res.status).toBe(404)
  })

  it('cannot mark another household’s settlement transaction as paid', async () => {
    const res = await asBob(
      request(app)
        .patch(`/api/v1/settlements/${settlementA}/transactions/${transactionA}`)
        .send({ paid: true })
    )
    expect(res.status).toBe(403)

    // And the transaction really is untouched.
    const check = await db.query<{ paid_at: Date | null }>(
      'SELECT paid_at FROM settlement_transactions WHERE id = $1',
      [transactionA]
    )
    expect(check.rows[0]?.paid_at).toBeNull()
  })
})

// ─── Project routes ───────────────────────────────────────────────────────────

describe('household isolation: projects', () => {
  it('cannot list another household’s projects', async () => {
    const res = await asBob(request(app).get(`/api/v1/households/${householdA}/projects`))
    expect(res.status).toBe(403)
  })

  it('cannot create a project in another household', async () => {
    const res = await asBob(
      request(app)
        .post(`/api/v1/households/${householdA}/projects`)
        .send({
          name: 'Trojan project',
          memberIds: [bob.id],
          allocationKey: [{ userId: bob.id, shareBp: 10_000 }],
        })
    )
    expect(res.status).toBe(403)
  })

  it('cannot pull members of another household into an own project', async () => {
    const res = await asBob(
      request(app)
        .post(`/api/v1/households/${householdB}/projects`)
        .send({
          name: 'Kidnap project',
          memberIds: [alice.id],
          allocationKey: [{ userId: alice.id, shareBp: 10_000 }],
        })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_MEMBERS')
  })

  it('cannot read another household’s project', async () => {
    const res = await asBob(request(app).get(`/api/v1/projects/${projectA}`))
    expect(res.status).toBe(403)
  })

  it('cannot list another project’s expenses', async () => {
    const res = await asBob(request(app).get(`/api/v1/projects/${projectA}/expenses`))
    expect(res.status).toBe(403)
  })

  it('cannot read a single expense from another project', async () => {
    const res = await asBob(request(app).get(`/api/v1/projects/${projectA}/expenses/${projectExpenseA}`))
    expect(res.status).toBe(403)
  })

  it('cannot add expenses to another household’s project', async () => {
    const res = await asBob(
      request(app)
        .post(`/api/v1/projects/${projectA}/expenses`)
        .send({
          purchasedBy: bob.id,
          lineItems: [{ description: 'Sneaky', quantity: 1, unitPriceOre: 100 }],
        })
    )
    expect(res.status).toBe(403)
  })

  it('cannot finish another household’s project', async () => {
    const res = await asBob(request(app).post(`/api/v1/projects/${projectA}/finish`))
    expect(res.status).toBe(403)
  })

  it('cannot attribute a project expense to a non-member of the project', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectA}/expenses`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({
        purchasedBy: bob.id,
        lineItems: [{ description: 'Misattributed', quantity: 1, unitPriceOre: 100 }],
      })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_PURCHASER')
  })
})

// ─── Statistics routes ────────────────────────────────────────────────────────

describe('household isolation: statistics', () => {
  it('cannot read another household’s statistics', async () => {
    const res = await asBob(request(app).get(`/api/v1/households/${householdA}/statistics`))
    expect(res.status).toBe(403)
  })

  it('cannot read another household’s category drill-down', async () => {
    const res = await asBob(
      request(app).get(`/api/v1/households/${householdA}/statistics/category/uncategorized`)
    )
    expect(res.status).toBe(403)
  })

  it('cannot export another household’s expenses as CSV', async () => {
    const res = await asBob(
      request(app).get(`/api/v1/households/${householdA}/statistics/export`)
    )
    expect(res.status).toBe(403)
  })
})

// ─── Category routes ──────────────────────────────────────────────────────────

describe('household isolation: categories', () => {
  it('cannot list another household’s categories', async () => {
    const res = await asBob(request(app).get(`/api/v1/households/${householdA}/categories`))
    expect(res.status).toBe(403)
  })

  it('cannot rename another household’s category', async () => {
    const res = await asBob(
      request(app)
        .patch(`/api/v1/households/${householdA}/categories/${categoryA}`)
        .send({ name: 'Renamed' })
    )
    expect(res.status).toBe(403)
  })

  it('cannot delete another household’s category', async () => {
    const res = await asBob(
      request(app).delete(`/api/v1/households/${householdA}/categories/${categoryA}`)
    )
    expect(res.status).toBe(403)
  })
})

// ─── Draft creation from a receipt ─────────────────────────────────────────────

describe('household isolation: from-receipt', () => {
  it('cannot create a draft from a receipt in another household', async () => {
    const image = await fakeReceiptImage()
    const res = await asBob(
      request(app)
        .post(`/api/v1/households/${householdA}/expenses/from-receipt`)
        .field('captureId', randomUUID())
        .attach('receipt', image, { filename: 'receipt.jpg', contentType: 'image/jpeg' })
    )
    expect(res.status).toBe(403)
  })

  it('cannot create a draft from a receipt in another household’s project', async () => {
    const image = await fakeReceiptImage()
    const res = await asBob(
      request(app)
        .post(`/api/v1/projects/${projectA}/expenses/from-receipt`)
        .field('captureId', randomUUID())
        .attach('receipt', image, { filename: 'receipt.jpg', contentType: 'image/jpeg' })
    )
    expect(res.status).toBe(403)
  })

  it('replaying the same captureId returns the existing draft and creates nothing else (SC-009)', async () => {
    const captureId = randomUUID()
    const image = await fakeReceiptImage()

    const first = await request(app)
      .post(`/api/v1/households/${householdA}/expenses/from-receipt`)
      .set('Authorization', `Bearer ${alice.token}`)
      .field('captureId', captureId)
      .attach('receipt', image, { filename: 'r.jpg', contentType: 'image/jpeg' })
    expect(first.status).toBe(201)

    const replay = await request(app)
      .post(`/api/v1/households/${householdA}/expenses/from-receipt`)
      .set('Authorization', `Bearer ${alice.token}`)
      .field('captureId', captureId)
      .attach('receipt', image, { filename: 'r.jpg', contentType: 'image/jpeg' })
    expect(replay.status).toBe(200)
    expect(replay.body.id).toBe(first.body.id)

    const count = await db.query<{ count: string }>(
      'SELECT count(*) FROM expenses WHERE household_id = $1 AND capture_id = $2',
      [householdA, captureId]
    )
    expect(Number(count.rows[0]!.count)).toBe(1)
  })

  it('rejects confirming a draft with zero line items (409 EMPTY_EXPENSE)', async () => {
    const bare = await db.query<{ id: string }>(
      `INSERT INTO expenses (household_id, purchased_by, total_amount_ore, status)
       VALUES ($1, $2, 0, 'pending_review') RETURNING id`,
      [householdA, alice.id]
    )
    const res = await request(app)
      .post(`/api/v1/households/${householdA}/expenses/${bare.rows[0]!.id}/confirm`)
      .set('Authorization', `Bearer ${alice.token}`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('EMPTY_EXPENSE')
  })
})

// ─── Draft editing ──────────────────────────────────────────────────────────────

describe('household isolation: draft editing', () => {
  it('cannot edit another household’s draft fields', async () => {
    const res = await asBob(
      request(app).patch(`/api/v1/households/${householdA}/expenses/${draftA}`).send({ store: 'Hacked' })
    )
    expect(res.status).toBe(403)
  })

  it('cannot edit a foreign draft through own household URL (ID stuffing)', async () => {
    const res = await asBob(
      request(app).patch(`/api/v1/households/${householdB}/expenses/${draftA}`).send({ store: 'Hacked' })
    )
    expect(res.status).toBe(404)
  })

  it('cannot add a line item to another household’s draft', async () => {
    const res = await asBob(
      request(app)
        .post(`/api/v1/households/${householdA}/expenses/${draftA}/line-items`)
        .send({ description: 'Sneaky', quantity: 1, unitPriceOre: 100 })
    )
    expect(res.status).toBe(403)
  })

  it('cannot add a line item to a foreign draft through own household URL', async () => {
    const res = await asBob(
      request(app)
        .post(`/api/v1/households/${householdB}/expenses/${draftA}/line-items`)
        .send({ description: 'Sneaky', quantity: 1, unitPriceOre: 100 })
    )
    expect(res.status).toBe(404)
  })

  it('cannot delete a line item from another household’s draft', async () => {
    const res = await asBob(
      request(app).delete(`/api/v1/households/${householdA}/expenses/${draftA}/line-items/${draftLineItemA}`)
    )
    expect(res.status).toBe(403)
  })

  it('cannot delete a foreign draft’s line item through own household URL', async () => {
    const res = await asBob(
      request(app).delete(`/api/v1/households/${householdB}/expenses/${draftA}/line-items/${draftLineItemA}`)
    )
    expect(res.status).toBe(404)
  })
})

describe('household isolation: project draft editing', () => {
  it('cannot edit another household’s project draft fields', async () => {
    const res = await asBob(
      request(app).patch(`/api/v1/projects/${projectA}/expenses/${projectDraftA}`).send({ store: 'Hacked' })
    )
    expect(res.status).toBe(403)
  })

  it('cannot add a line item to another household’s project draft', async () => {
    const res = await asBob(
      request(app)
        .post(`/api/v1/projects/${projectA}/expenses/${projectDraftA}/line-items`)
        .send({ description: 'Sneaky', quantity: 1, unitPriceOre: 100 })
    )
    expect(res.status).toBe(403)
  })

  it('cannot edit a line item on another household’s project draft', async () => {
    const lineItemRes = await request(app)
      .get(`/api/v1/projects/${projectA}/expenses/${projectDraftA}`)
      .set('Authorization', `Bearer ${alice.token}`)
    const lineItemId = lineItemRes.body.lineItems[0].id

    const res = await asBob(
      request(app)
        .patch(`/api/v1/projects/${projectA}/expenses/${projectDraftA}/line-items/${lineItemId}`)
        .send({ unitPriceOre: 1 })
    )
    expect(res.status).toBe(403)
  })

  it('cannot delete a line item from another household’s project draft', async () => {
    const lineItemRes = await request(app)
      .get(`/api/v1/projects/${projectA}/expenses/${projectDraftA}`)
      .set('Authorization', `Bearer ${alice.token}`)
    const lineItemId = lineItemRes.body.lineItems[0].id

    const res = await asBob(
      request(app).delete(`/api/v1/projects/${projectA}/expenses/${projectDraftA}/line-items/${lineItemId}`)
    )
    expect(res.status).toBe(403)
  })

  it('cannot edit a foreign project’s draft through own project URL (ID stuffing)', async () => {
    const res = await asBob(
      request(app).patch(`/api/v1/projects/${projectB}/expenses/${projectDraftA}`).send({ store: 'Hacked' })
    )
    expect(res.status).toBe(404)
  })

  it('cannot add a line item to a foreign project’s draft through own project URL', async () => {
    const res = await asBob(
      request(app)
        .post(`/api/v1/projects/${projectB}/expenses/${projectDraftA}/line-items`)
        .send({ description: 'Sneaky', quantity: 1, unitPriceOre: 100 })
    )
    expect(res.status).toBe(404)
  })

  it('cannot read a foreign project’s draft through own project URL', async () => {
    const res = await asBob(request(app).get(`/api/v1/projects/${projectB}/expenses/${projectDraftA}`))
    expect(res.status).toBe(404)
  })

  it('cannot confirm another household’s project draft', async () => {
    const res = await asBob(
      request(app).post(`/api/v1/projects/${projectA}/expenses/${projectDraftA}/confirm`)
    )
    expect(res.status).toBe(403)
  })
})

// ─── Receipt and avatar images ────────────────────────────────────────────────
// Images are served through authenticated API routes rather than expiring
// signed object-store URLs — this closes the gap where a signed URL outlives
// the session that minted it. See AUTHORIZATION.md invariant 6.

describe('household isolation: receipt images', () => {
  it('rejects an unauthenticated request for a household expense receipt', async () => {
    const res = await request(app).get(`/api/v1/households/${householdA}/expenses/${expenseA}/receipt`)
    expect(res.status).toBe(401)
  })

  it('cannot fetch another household’s expense receipt', async () => {
    const res = await asBob(
      request(app).get(`/api/v1/households/${householdA}/expenses/${expenseA}/receipt`)
    )
    expect(res.status).toBe(403)
  })

  it('cannot fetch a foreign expense receipt through own household URL (ID stuffing)', async () => {
    const res = await asBob(
      request(app).get(`/api/v1/households/${householdB}/expenses/${expenseA}/receipt`)
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when the expense has no receipt', async () => {
    const res = await request(app)
      .get(`/api/v1/households/${householdA}/expenses/${expenseA}/receipt`)
      .set('Authorization', `Bearer ${anna.token}`)
    expect(res.status).toBe(404)
  })
})

describe('household isolation: project expense receipt images', () => {
  it('rejects an unauthenticated request for a project expense receipt', async () => {
    const res = await request(app).get(`/api/v1/projects/${projectA}/expenses/${projectExpenseA}/receipt`)
    expect(res.status).toBe(401)
  })

  it('cannot fetch a project expense receipt as a non-member', async () => {
    const res = await asBob(
      request(app).get(`/api/v1/projects/${projectA}/expenses/${projectExpenseA}/receipt`)
    )
    expect(res.status).toBe(403)
  })

  it('returns 404 when the project expense has no receipt', async () => {
    const res = await request(app)
      .get(`/api/v1/projects/${projectA}/expenses/${projectExpenseA}/receipt`)
      .set('Authorization', `Bearer ${anna.token}`)
    expect(res.status).toBe(404)
  })
})

describe('user isolation: avatar', () => {
  it('rejects an unauthenticated request for an avatar', async () => {
    const res = await request(app).get('/api/v1/users/me/avatar')
    expect(res.status).toBe(401)
  })

  it('returns 404 when the caller has no avatar set', async () => {
    const res = await request(app)
      .get('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${alice.token}`)
    expect(res.status).toBe(404)
  })
})

// ─── User-owned resources ─────────────────────────────────────────────────────

describe('user isolation: cards', () => {
  it('cannot delete another user’s card', async () => {
    const res = await asBob(request(app).delete(`/api/v1/users/me/cards/${cardA}`))
    expect(res.status).toBe(404)

    const check = await db.query('SELECT id FROM cards WHERE id = $1', [cardA])
    expect(check.rows).toHaveLength(1)
  })
})
