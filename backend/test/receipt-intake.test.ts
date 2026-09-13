// The receipt parser degrades to zero items on timeout or API failure (see
// receiptParser.ts) rather than throwing — from-receipt must still create a
// usable draft in that case: the image is kept, there are just no line items
// for the member to review by hand. Confirming that empty draft is rejected.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import sharp from 'sharp'
import { randomUUID } from 'node:crypto'

vi.mock('../src/services/email.js', () => ({
  sendInviteEmail: vi.fn(async () => {}),
  sendSettlementReadyEmail: vi.fn(async () => {}),
}))

// Simulates the real degrade-to-empty behaviour of a parser timeout/failure.
vi.mock('../src/services/receiptParser.js', () => ({
  parseReceipt: vi.fn(async () => ({
    store: null,
    date: null,
    detectedCardLastFour: null,
    items: [],
  })),
}))
vi.mock('../src/services/categorizer.js', () => ({
  categorizeWithAI: vi.fn(async () => []),
}))

import { app } from '../src/app.js'
import { db } from '../src/db/client.js'

describe('from-receipt with a failed parse', () => {
  let userToken: string
  let householdId: string

  beforeAll(async () => {
    const tables = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_migrations'"
    )
    await db.query(`TRUNCATE TABLE ${tables.rows.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`)

    const passwordHash = await bcrypt.hash('correct-horse-battery', 12)
    const userInsert = await db.query<{ id: string }>(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
      ['scanner@a.example', passwordHash, 'Scanner']
    )
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'scanner@a.example', password: 'correct-horse-battery' })
    userToken = login.body.accessToken

    const createRes = await request(app)
      .post('/api/v1/households')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Solo household', allocationKey: [{ userId: userInsert.rows[0]!.id, shareBp: 10_000 }] })
    householdId = createRes.body.id

    // Households start 'pending' until a second member joins; this suite only
    // exercises receipt intake, so activate directly rather than going through
    // the invite flow.
    await db.query("UPDATE households SET status = 'active' WHERE id = $1", [householdId])
  })

  afterAll(async () => {
    await db.end()
  })

  it('still creates a draft with the image attached and zero line items', async () => {
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } }).jpeg().toBuffer()

    const res = await request(app)
      .post(`/api/v1/households/${householdId}/expenses/from-receipt`)
      .set('Authorization', `Bearer ${userToken}`)
      .field('captureId', randomUUID())
      .attach('receipt', image, { filename: 'receipt.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('pending_review')
    expect(res.body.lineItems).toHaveLength(0)
    expect(res.body.receiptImageKey).toBeTruthy()
    expect(res.body.receiptImageUrl).toBeTruthy()
  })

  it('rejects confirming that zero-item draft (409 EMPTY_EXPENSE)', async () => {
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } }).jpeg().toBuffer()

    const draft = await request(app)
      .post(`/api/v1/households/${householdId}/expenses/from-receipt`)
      .set('Authorization', `Bearer ${userToken}`)
      .field('captureId', randomUUID())
      .attach('receipt', image, { filename: 'receipt.jpg', contentType: 'image/jpeg' })
    expect(draft.status).toBe(201)

    const confirmRes = await request(app)
      .post(`/api/v1/households/${householdId}/expenses/${draft.body.id}/confirm`)
      .set('Authorization', `Bearer ${userToken}`)
    expect(confirmRes.status).toBe(409)
    expect(confirmRes.body.error.code).toBe('EMPTY_EXPENSE')
  })
})
