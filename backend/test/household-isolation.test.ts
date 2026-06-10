// Negative authorization tests: a member of household B must not be able to
// read or mutate anything belonging to household A — via the obvious routes
// (wrong householdId in the URL) and via ID-stuffing (own householdId in the
// URL but a foreign resource ID).
//
// Fixture: two fully active two-member households, each with an expense, an
// open settlement, and a project. "intruder" is the admin of household B.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'

// Email goes out on settlement creation; never hit the network from tests.
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
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: 'correct-horse-battery', name })
  expect(res.status).toBe(201)
  return { id: res.body.user.id, email, token: res.body.accessToken }
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
let categoryA: string
let cardA: string

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
    expect(res.body.expenses).toHaveLength(1)
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

// ─── Receipt parsing ──────────────────────────────────────────────────────────

describe('household isolation: receipts', () => {
  it('cannot parse a receipt into another household', async () => {
    // Membership is checked before any upload/AI call, so no external
    // services are reached and the request dies with 403.
    const res = await asBob(
      request(app)
        .post(`/api/v1/receipts/parse?householdId=${householdA}`)
        .attach('receipt', Buffer.from('fake-image-bytes'), {
          filename: 'receipt.jpg',
          contentType: 'image/jpeg',
        })
    )
    expect(res.status).toBe(403)
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
