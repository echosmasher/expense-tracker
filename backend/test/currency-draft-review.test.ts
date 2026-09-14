// Ticket 14 (spec 005): currency on the draft review screen. Covers the
// parser's currency contract feeding from-receipt draft creation (resolved
// and pending rate paths), the project default-currency fallback, changing a
// draft's currency through the edit route, and confirm rejecting a pending
// rate. The Norges Bank fetch is never exercised here — rates are pre-seeded
// into the cache table directly, mirroring the "cache hit" path already
// covered by exchange-rates.test.ts.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import sharp from 'sharp'
import { randomUUID } from 'node:crypto'
import { homeOre } from '@expense-tracker/shared'

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

async function seedRate(currency: string, rateDate: string, rateScaled: bigint) {
  await db.query(
    `INSERT INTO exchange_rates (currency, rate_date, rate_scaled, source, fetched_at)
     VALUES ($1, $2, $3, 'norges_bank', now())
     ON CONFLICT (currency, rate_date) DO NOTHING`,
    [currency, rateDate, rateScaled.toString()]
  )
}

function testImage() {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } }).jpeg().toBuffer()
}

async function uploadReceipt(token: string, householdId: string) {
  const image = await testImage()
  return request(app)
    .post(`/api/v1/households/${householdId}/expenses/from-receipt`)
    .set('Authorization', `Bearer ${token}`)
    .field('captureId', randomUUID())
    .attach('receipt', image, { filename: 'receipt.jpg', contentType: 'image/jpeg' })
}

let admin: TestUser
let householdId: string

beforeAll(async () => {
  admin = await registerUser('Draft Review Admin', 'draft-review-admin@example.com')
  householdId = await createActiveHousehold(admin, 'Draft Review Household')
})

describe('from-receipt — parser reports a currency (ticket 14)', () => {
  it('a resolvable foreign currency stores original amounts and converts every line', async () => {
    // 11.6543 NOK/PLN, seeded on the draft's parsed date so resolution hits
    // cache on the exact date (source 'norges_bank').
    await seedRate('PLN', '2026-07-01', 11_654_300n)
    parseReceiptMock.mockResolvedValueOnce({
      store: 'Café de Paris',
      date: '2026-07-01',
      detectedCardLastFour: null,
      currency: 'PLN',
      items: [
        { description: 'Lunch', quantity: 1, unitPriceOre: 1250, confidenceLow: false },
        { description: 'Coffee', quantity: 2, unitPriceOre: 300, confidenceLow: false },
      ],
    })

    const res = await uploadReceipt(admin.token, householdId)

    expect(res.status).toBe(201)
    expect(res.body.currency).toBe('PLN')
    expect(res.body.rateSource).toBe('norges_bank')
    expect(res.body.rateScaled).toBe('11654300')
    expect(res.body.originalTotalMinor).toBe(1250 + 300 * 2)

    const lunch = res.body.lineItems.find((li: { description: string }) => li.description === 'Lunch')
    expect(lunch.originalUnitPriceMinor).toBe(1250)
    expect(lunch.originalTotalMinor).toBe(1250)
    expect(lunch.unitPriceOre).toBe(14568) // worked example from the plan

    // The household-billable total is the sum of each line's direct total
    // conversion — not unitPriceOre (a rounded per-unit display value) ×
    // quantity, which can drift (see currency.test.ts's regression case).
    const expectedTotal = res.body.lineItems.reduce(
      (sum: number, li: { originalTotalMinor: number }) => sum + homeOre(li.originalTotalMinor, 11_654_300n, 2),
      0
    )
    expect(res.body.totalAmountOre).toBe(expectedTotal)
  })

  it('an unresolvable currency (unknown to Norges Bank) produces a pending draft with zero home amounts', async () => {
    parseReceiptMock.mockResolvedValueOnce({
      store: 'Somewhere Unusual',
      date: '2026-07-02',
      detectedCardLastFour: null,
      currency: 'ZZZ',
      items: [{ description: 'Mystery item', quantity: 1, unitPriceOre: 500, confidenceLow: false }],
    })

    const res = await uploadReceipt(admin.token, householdId)

    expect(res.status).toBe(201)
    expect(res.body.currency).toBe('ZZZ')
    expect(res.body.rateSource).toBe('pending')
    expect(res.body.rateScaled).toBeNull()
    expect(res.body.totalAmountOre).toBe(0)
    expect(res.body.lineItems[0].unitPriceOre).toBe(0)
    expect(res.body.lineItems[0].originalUnitPriceMinor).toBe(500)
  })

  it('rejects confirming a draft with a pending rate (409 RATE_PENDING)', async () => {
    parseReceiptMock.mockResolvedValueOnce({
      store: 'Pending Store',
      date: '2026-07-03',
      detectedCardLastFour: null,
      currency: 'ZZZ',
      items: [{ description: 'Item', quantity: 1, unitPriceOre: 100, confidenceLow: false }],
    })
    const draft = await uploadReceipt(admin.token, householdId)
    expect(draft.status).toBe(201)

    const confirmRes = await request(app)
      .post(`/api/v1/households/${householdId}/expenses/${draft.body.id}/confirm`)
      .set('Authorization', `Bearer ${admin.token}`)

    expect(confirmRes.status).toBe(409)
    expect(confirmRes.body.error.code).toBe('RATE_PENDING')
  })

  it('a pending draft in a currency Norges Bank does not publish can still be rescued with a manual rate', async () => {
    parseReceiptMock.mockResolvedValueOnce({
      store: 'Rescue Store',
      date: '2026-07-03',
      detectedCardLastFour: null,
      currency: 'ZZZ',
      items: [{ description: 'Item', quantity: 2, unitPriceOre: 150, confidenceLow: false }],
    })
    const draft = await uploadReceipt(admin.token, householdId)
    expect(draft.body.rateSource).toBe('pending')

    // The same currency, paired with a manual rate — exactly the call the
    // review screen's manual-rate form makes for a pending, unsupported
    // currency (spec edge case: an unsupported currency can still be
    // recorded with a manually entered rate).
    const patchRes = await request(app)
      .patch(`/api/v1/households/${householdId}/expenses/${draft.body.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ currency: 'ZZZ', rateScaled: 9_000_000 }) // 9.0 NOK/ZZZ

    expect(patchRes.status).toBe(200)
    expect(patchRes.body.currency).toBe('ZZZ')
    expect(patchRes.body.rateSource).toBe('manual')
    expect(patchRes.body.lineItems[0].unitPriceOre).toBe(1350) // 150 × 9.0, 2-decimal fallback exponent

    const confirmRes = await request(app)
      .post(`/api/v1/households/${householdId}/expenses/${draft.body.id}/confirm`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(confirmRes.status).toBe(200)
  })

  it('no currency detected falls back to the household home currency (NOK, unchanged flow)', async () => {
    parseReceiptMock.mockResolvedValueOnce({
      store: 'Rema 1000',
      date: '2026-07-04',
      detectedCardLastFour: null,
      currency: null,
      items: [{ description: 'Melk', quantity: 1, unitPriceOre: 2500, confidenceLow: false }],
    })

    const res = await uploadReceipt(admin.token, householdId)

    expect(res.status).toBe(201)
    expect(res.body.currency).toBe('NOK')
    expect(res.body.rateSource).toBeNull()
    expect(res.body.originalTotalMinor).toBeNull()
    expect(res.body.lineItems[0].unitPriceOre).toBe(2500)
  })
})

describe('PATCH /households/:id/expenses/:id — changing a draft currency (ticket 14)', () => {
  it('supplying a manual rate in the same call stores it as manual and reconverts every line', async () => {
    parseReceiptMock.mockResolvedValueOnce({
      store: 'Corner Shop',
      date: '2026-07-05',
      detectedCardLastFour: null,
      currency: null,
      items: [{ description: 'Snack', quantity: 2, unitPriceOre: 500, confidenceLow: false }],
    })
    const draft = await uploadReceipt(admin.token, householdId)
    expect(draft.status).toBe(201)
    expect(draft.body.currency).toBe('NOK')

    const patchRes = await request(app)
      .patch(`/api/v1/households/${householdId}/expenses/${draft.body.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ currency: 'USD', rateScaled: 10_500_000 }) // 10.5 NOK/USD

    expect(patchRes.status).toBe(200)
    expect(patchRes.body.currency).toBe('USD')
    expect(patchRes.body.rateSource).toBe('manual')
    expect(patchRes.body.rateScaled).toBe('10500000')

    const li = patchRes.body.lineItems[0]
    // The draft's pre-change home amount (500 øre) seeds the original amount
    // when there was none yet (home → foreign switch).
    expect(li.originalUnitPriceMinor).toBe(500)
    expect(li.unitPriceOre).toBe(5250) // 500 minor units × 10.5 NOK
    expect(patchRes.body.totalAmountOre).toBe(5250 * 2)
  })

  it('changing to a different foreign currency re-resolves the rate and reconverts using the existing original amount', async () => {
    await seedRate('PLN', '2026-07-06', 11_000_000n) // 11.0 NOK/PLN
    parseReceiptMock.mockResolvedValueOnce({
      store: 'Multi-currency stop',
      date: '2026-07-06',
      detectedCardLastFour: null,
      currency: 'PLN',
      items: [{ description: 'Snack', quantity: 1, unitPriceOre: 1000, confidenceLow: false }],
    })
    const draft = await uploadReceipt(admin.token, householdId)
    expect(draft.body.currency).toBe('PLN')
    expect(draft.body.lineItems[0].unitPriceOre).toBe(11000) // 1000 × 11.0

    await seedRate('GBP', '2026-07-06', 13_000_000n) // 13.0 NOK/GBP
    const patchRes = await request(app)
      .patch(`/api/v1/households/${householdId}/expenses/${draft.body.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ currency: 'GBP' })

    expect(patchRes.status).toBe(200)
    expect(patchRes.body.currency).toBe('GBP')
    expect(patchRes.body.rateSource).toBe('norges_bank')
    const li = patchRes.body.lineItems[0]
    expect(li.originalUnitPriceMinor).toBe(1000) // reused, not re-parsed
    expect(li.unitPriceOre).toBe(13000) // 1000 × 13.0
  })
})

describe('line items on a foreign draft (ticket 14)', () => {
  it('adding a line item takes originalUnitPriceMinor and the server derives home amounts', async () => {
    await seedRate('PLN', '2026-07-07', 11_000_000n)
    parseReceiptMock.mockResolvedValueOnce({
      store: 'Add-item store',
      date: '2026-07-07',
      detectedCardLastFour: null,
      currency: 'PLN',
      items: [{ description: 'Existing', quantity: 1, unitPriceOre: 500, confidenceLow: false }],
    })
    const draft = await uploadReceipt(admin.token, householdId)
    expect(draft.body.currency).toBe('PLN')

    const addRes = await request(app)
      .post(`/api/v1/households/${householdId}/expenses/${draft.body.id}/line-items`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ description: 'New item', quantity: 3, originalUnitPriceMinor: 200, isPersonal: false })

    expect(addRes.status).toBe(201)
    const added = addRes.body.lineItems.find((li: { description: string }) => li.description === 'New item')
    expect(added.originalUnitPriceMinor).toBe(200)
    expect(added.originalTotalMinor).toBe(600)
    expect(added.unitPriceOre).toBe(2200) // 200 × 11.0
    expect(addRes.body.originalTotalMinor).toBe(500 + 600)
  })

  it('rejects adding a line item to a foreign draft without originalUnitPriceMinor', async () => {
    await seedRate('PLN', '2026-07-08', 11_000_000n)
    parseReceiptMock.mockResolvedValueOnce({
      store: 'Reject store',
      date: '2026-07-08',
      detectedCardLastFour: null,
      currency: 'PLN',
      items: [{ description: 'Existing', quantity: 1, unitPriceOre: 500, confidenceLow: false }],
    })
    const draft = await uploadReceipt(admin.token, householdId)

    const addRes = await request(app)
      .post(`/api/v1/households/${householdId}/expenses/${draft.body.id}/line-items`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ description: 'New item', quantity: 1, unitPriceOre: 200, isPersonal: false })

    expect(addRes.status).toBe(400)
    expect(addRes.body.error.code).toBe('NON_INTEGER_AMOUNT')
  })
})

describe('project default currency (ticket 14)', () => {
  let projectId: string

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/v1/households/${householdId}/projects`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        name: 'Summer trip',
        memberIds: [admin.id],
        allocationKey: [{ userId: admin.id, shareBp: 10_000 }],
        defaultCurrency: 'PLN',
      })
    expect(res.status).toBe(201)
    expect(res.body.defaultCurrency).toBe('PLN')
    projectId = res.body.id
  })

  it('pre-selects the project default currency when the receipt gives none', async () => {
    await seedRate('PLN', '2026-07-09', 11_200_000n)
    parseReceiptMock.mockResolvedValueOnce({
      store: 'Trip store',
      date: '2026-07-09',
      detectedCardLastFour: null,
      currency: null,
      items: [{ description: 'Souvenir', quantity: 1, unitPriceOre: 1000, confidenceLow: false }],
    })

    const image = await testImage()
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/expenses/from-receipt`)
      .set('Authorization', `Bearer ${admin.token}`)
      .field('captureId', randomUUID())
      .attach('receipt', image, { filename: 'receipt.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(201)
    expect(res.body.currency).toBe('PLN')
    expect(res.body.rateSource).toBe('norges_bank')
    expect(res.body.lineItems[0].unitPriceOre).toBe(11200) // 1000 × 11.2
  })
})

describe('POST /households/:id/projects — default currency validation', () => {
  it('rejects an unknown default currency', async () => {
    const res = await request(app)
      .post(`/api/v1/households/${householdId}/projects`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        name: 'Bad currency project',
        memberIds: [admin.id],
        allocationKey: [{ userId: admin.id, shareBp: 10_000 }],
        defaultCurrency: 'ZZZ',
      })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('UNKNOWN_CURRENCY')
  })
})
