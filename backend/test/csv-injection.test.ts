// The statistics CSV export must neutralize spreadsheet formula injection:
// a store/item name beginning with = + - @ would otherwise be evaluated as a
// formula when the file is opened in Excel or Google Sheets.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'

vi.mock('../src/services/email.js', () => ({
  sendInviteEmail: vi.fn(async () => {}),
  sendSettlementReadyEmail: vi.fn(async () => {}),
}))

import { app } from '../src/app.js'
import { db } from '../src/db/client.js'

const PASSWORD = 'correct-horse-battery'
const MONTH = '2026-06'

let token: string
let householdId: string

beforeAll(async () => {
  const tables = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_migrations'"
  )
  await db.query(
    `TRUNCATE TABLE ${tables.rows.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`
  )

  const reg = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'csv@example.com', password: PASSWORD, name: 'Csv' })
  token = reg.body.accessToken
  const userId = reg.body.user.id

  const hh = await request(app)
    .post('/api/v1/households')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'CSV household', allocationKey: [{ userId, shareBp: 10_000 }] })
  householdId = hh.body.id
  await db.query("UPDATE households SET status = 'active' WHERE id = $1", [householdId])

  // Expense whose store and item names are formula-injection payloads.
  const created = await request(app)
    .post(`/api/v1/households/${householdId}/expenses`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      store: '=HYPERLINK("http://evil.test","click")',
      date: `${MONTH}-15`,
      purchasedBy: userId,
      lineItems: [
        { description: '@SUM(A1:A9)', quantity: 1, unitPriceOre: 5000 },
        { description: 'safe milk', quantity: 1, unitPriceOre: 2000 },
      ],
    })
  expect(created.status).toBe(201)
  await request(app)
    .post(`/api/v1/households/${householdId}/expenses/${created.body.id}/confirm`)
    .set('Authorization', `Bearer ${token}`)
})

afterAll(async () => {
  await db.end()
})

describe('CSV export formula-injection guard', () => {
  it('prefixes dangerous cells with a single quote and leaves safe cells alone', async () => {
    const res = await request(app)
      .get(`/api/v1/households/${householdId}/statistics/export?month=${MONTH}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')

    const csv = res.text
    // Dangerous values are quoted AND prefixed with ' so no cell starts with =/@.
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.test"",""click"")"`)
    expect(csv).toContain(`"'@SUM(A1:A9)"`)
    // A benign value is untouched (no spurious leading quote).
    expect(csv).toContain('"safe milk"')
    expect(csv).not.toContain(`"'safe milk"`)

    // Belt and braces: no data cell begins with a formula trigger.
    const dataLines = csv.split('\n').slice(1).filter(Boolean)
    for (const line of dataLines) {
      for (const cell of line.split(',')) {
        const inner = cell.replace(/^"|"$/g, '')
        expect(/^[=+\-@\t\r]/.test(inner)).toBe(false)
      }
    }
  })
})
