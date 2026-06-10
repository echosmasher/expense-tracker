// Auth lifecycle tests: registration, login, access-token validation,
// refresh-token rotation, logout revocation, the invite flow, and password
// change. The invite token is captured through the mocked email service —
// exactly the way it leaves the system in production.
//
// NOTE: the auth rate limiter is in-memory and counts failed requests per
// process (successful ones are skipped). The rate-limit test runs LAST in
// this file because it deliberately exhausts the budget.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'

vi.mock('../src/services/email.js', () => ({
  sendInviteEmail: vi.fn(async () => {}),
  sendSettlementReadyEmail: vi.fn(async () => {}),
}))

import { app } from '../src/app.js'
import { db } from '../src/db/client.js'
import { sendInviteEmail } from '../src/services/email.js'

const PASSWORD = 'correct-horse-battery'

function refreshCookieOf(res: request.Response): string {
  const setCookie: string[] = res.headers['set-cookie'] ?? []
  const cookie = setCookie.find((c) => c.startsWith('refresh_token='))
  expect(cookie, 'expected a refresh_token cookie').toBeDefined()
  return cookie!.split(';')[0]!
}

async function register(name: string, email: string) {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, name })
  expect(res.status).toBe(201)
  return { id: res.body.user.id as string, email, token: res.body.accessToken as string, res }
}

/** The invite token only exists in the email — pull it from the mock. */
function lastInviteToken(): string {
  const calls = vi.mocked(sendInviteEmail).mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1]![0].token
}

let admin: { id: string; email: string; token: string }
let member: { id: string; email: string; token: string }
let householdId: string

beforeAll(async () => {
  const tables = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_migrations'"
  )
  await db.query(
    `TRUNCATE TABLE ${tables.rows.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`
  )

  admin = await register('Admin', 'admin@auth.example')
  member = await register('Member', 'member@auth.example')

  const hhRes = await request(app)
    .post('/api/v1/households')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ name: 'Auth household', allocationKey: [{ userId: admin.id, shareBp: 10_000 }] })
  expect(hhRes.status).toBe(201)
  householdId = hhRes.body.id
})

afterAll(async () => {
  await db.end()
})

// ─── Registration ─────────────────────────────────────────────────────────────

describe('registration', () => {
  it('returns an access token and sets an httpOnly refresh cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'fresh@auth.example', password: PASSWORD, name: 'Fresh' })
    expect(res.status).toBe(201)
    expect(res.body.accessToken).toBeTruthy()
    expect(res.body.user.email).toBe('fresh@auth.example')
    // Password material must never leak in the response.
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i)

    const cookie: string = (res.headers['set-cookie'] as unknown as string[]).find((c: string) =>
      c.startsWith('refresh_token=')
    )!
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/api/v1/auth')
  })

  it('the issued access token works against protected routes', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(admin.id)
  })

  it('rejects a duplicate email with 409', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: admin.email, password: PASSWORD, name: 'Imposter' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS')
  })

  it('rejects a password shorter than 8 chars', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'short@auth.example', password: 'short', name: 'Short' })
    expect(res.status).toBe(400)
  })

  it('rejects an invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: PASSWORD, name: 'Bad' })
    expect(res.status).toBe(400)
  })
})

// ─── Login ────────────────────────────────────────────────────────────────────

describe('login', () => {
  it('succeeds with correct credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTruthy()
    refreshCookieOf(res)
  })

  it('rejects a wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: 'wrong-password' })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects an unknown email with the same error (no user enumeration)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@auth.example', password: PASSWORD })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })
})

// ─── Access token validation ──────────────────────────────────────────────────

describe('access token validation', () => {
  it('rejects a malformed token', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer definitely.not.a-jwt')
    expect(res.status).toBe(401)
  })

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ userId: admin.id, email: admin.email }, 'attacker-secret-key', {
      expiresIn: '15m',
    })
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${forged}`)
    expect(res.status).toBe(401)
  })

  it('rejects an expired token even with a valid signature', async () => {
    const expired = jwt.sign(
      { userId: admin.id, email: admin.email },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: '-1s' }
    )
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${expired}`)
    expect(res.status).toBe(401)
  })
})

// ─── Refresh rotation ─────────────────────────────────────────────────────────

describe('refresh token rotation', () => {
  it('rotates: refresh returns a new token and revokes the old one', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: PASSWORD })
    const firstCookie = refreshCookieOf(login)

    const refresh1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', firstCookie)
    expect(refresh1.status).toBe(200)
    expect(refresh1.body.accessToken).toBeTruthy()
    const secondCookie = refreshCookieOf(refresh1)
    expect(secondCookie).not.toBe(firstCookie)

    // Replaying the pre-rotation token must fail — this is the property that
    // limits the blast radius of a stolen refresh cookie.
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', firstCookie)
    expect(replay.status).toBe(401)

    // The rotated token still works.
    const refresh2 = await request(app).post('/api/v1/auth/refresh').set('Cookie', secondCookie)
    expect(refresh2.status).toBe(200)
  })

  it('rejects refresh without a cookie', async () => {
    const res = await request(app).post('/api/v1/auth/refresh')
    expect(res.status).toBe(401)
  })

  it('rejects a fabricated refresh token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${'f'.repeat(128)}`)
    expect(res.status).toBe(401)
  })

  it('rejects an expired refresh token', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: PASSWORD })
    const cookie = refreshCookieOf(login)

    // Age the token in the database rather than waiting 30 days.
    await db.query(
      `UPDATE refresh_tokens SET expires_at = now() - interval '1 minute'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [admin.id]
    )
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie)
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('REFRESH_TOKEN_EXPIRED')
  })
})

// ─── Logout ───────────────────────────────────────────────────────────────────

describe('logout', () => {
  it('revokes the refresh token and clears the cookie', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: PASSWORD })
    const cookie = refreshCookieOf(login)

    const logout = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie)
    expect(logout.status).toBe(204)

    const afterLogout = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie)
    expect(afterLogout.status).toBe(401)
  })
})

// ─── Invite flow ──────────────────────────────────────────────────────────────

describe('invite flow', () => {
  it('a non-admin household member cannot create invites', async () => {
    // member is not in the household at all yet; add them as plain member first.
    await db.query(
      "INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'member')",
      [householdId, member.id]
    )
    const res = await request(app)
      .post(`/api/v1/households/${householdId}/invites`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ email: 'whoever@auth.example' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ADMIN_ONLY')
    // Undo so invite-acceptance tests below control membership themselves.
    await db.query('DELETE FROM household_members WHERE household_id = $1 AND user_id = $2', [
      householdId,
      member.id,
    ])
  })

  it('admin invite → info → accept creates the account and activates the household', async () => {
    const inviteRes = await request(app)
      .post(`/api/v1/households/${householdId}/invites`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'newcomer@auth.example' })
    expect(inviteRes.status).toBe(201)
    const token = lastInviteToken()

    const info = await request(app).get(`/api/v1/auth/invite-info?token=${token}`)
    expect(info.status).toBe(200)
    expect(info.body.email).toBe('newcomer@auth.example')
    expect(info.body.isNewUser).toBe(true)

    const accept = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token, name: 'Newcomer', password: PASSWORD })
    expect(accept.status).toBe(200)
    expect(accept.body.householdId).toBe(householdId)
    expect(accept.body.accessToken).toBeTruthy()

    // Second member joined → household flips from pending to active.
    const hh = await db.query<{ status: string }>('SELECT status FROM households WHERE id = $1', [
      householdId,
    ])
    expect(hh.rows[0]!.status).toBe('active')

    // And the new credentials actually work.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'newcomer@auth.example', password: PASSWORD })
    expect(login.status).toBe(200)
  })

  it('an accepted invite cannot be used again', async () => {
    const token = lastInviteToken()
    const res = await request(app).post('/api/v1/auth/accept-invite').send({ token })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('TOKEN_ALREADY_USED')
  })

  it('accepting as an existing user requires no name/password', async () => {
    const inviteRes = await request(app)
      .post(`/api/v1/households/${householdId}/invites`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: member.email })
    expect(inviteRes.status).toBe(201)
    const token = lastInviteToken()

    const info = await request(app).get(`/api/v1/auth/invite-info?token=${token}`)
    expect(info.body.isNewUser).toBe(false)

    const accept = await request(app).post('/api/v1/auth/accept-invite').send({ token })
    expect(accept.status).toBe(200)

    const check = await db.query(
      'SELECT id FROM household_members WHERE household_id = $1 AND user_id = $2',
      [householdId, member.id]
    )
    expect(check.rows).toHaveLength(1)
  })

  it('a new user cannot accept without name and password', async () => {
    const inviteRes = await request(app)
      .post(`/api/v1/households/${householdId}/invites`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'incomplete@auth.example' })
    expect(inviteRes.status).toBe(201)
    const token = lastInviteToken()

    const res = await request(app).post('/api/v1/auth/accept-invite').send({ token })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects an expired invite', async () => {
    const inviteRes = await request(app)
      .post(`/api/v1/households/${householdId}/invites`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'late@auth.example' })
    expect(inviteRes.status).toBe(201)
    const token = lastInviteToken()

    await db.query("UPDATE invites SET expires_at = now() - interval '1 day' WHERE id = $1", [
      inviteRes.body.id,
    ])

    const info = await request(app).get(`/api/v1/auth/invite-info?token=${token}`)
    expect(info.status).toBe(410)

    const accept = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token, name: 'Late', password: PASSWORD })
    expect(accept.status).toBe(400)
    expect(accept.body.error.code).toBe('TOKEN_EXPIRED')
  })

  it('rejects a fabricated invite token', async () => {
    const res = await request(app).get(`/api/v1/auth/invite-info?token=${'a'.repeat(64)}`)
    expect(res.status).toBe(404)
  })

  it('admin cannot invite someone who is already a member', async () => {
    const res = await request(app)
      .post(`/api/v1/households/${householdId}/invites`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: member.email })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ALREADY_MEMBER')
  })
})

// ─── Password change ──────────────────────────────────────────────────────────

describe('password change', () => {
  it('rejects a wrong current password', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${member.token}`)
      .send({ currentPassword: 'wrong-password', newPassword: 'a-new-password-123' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('WRONG_PASSWORD')
  })

  it('changes the password; old stops working, new works', async () => {
    const change = await request(app)
      .post('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${member.token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'a-new-password-123' })
    expect(change.status).toBe(200)

    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: member.email, password: PASSWORD })
    expect(oldLogin.status).toBe(401)

    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: member.email, password: 'a-new-password-123' })
    expect(newLogin.status).toBe(200)
  })
})

// ─── Rate limiting (must stay LAST — it exhausts the per-IP budget) ───────────

describe('auth rate limiting', () => {
  it('throttles repeated failed login attempts with 429', async () => {
    let throttled = false
    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: admin.email, password: 'brute-force-attempt' })
      if (res.status === 429) {
        throttled = true
        break
      }
      expect(res.status).toBe(401)
    }
    expect(throttled).toBe(true)
  })
})
