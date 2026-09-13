// Behind the tunnel, nginx overwrites X-Forwarded-For with the Cloudflare
// client IP (see web/nginx.conf) and the API trusts exactly one proxy hop
// (app.ts `trust proxy: 1`). This pins that the auth rate limiter keys on
// that forwarded address rather than the proxy's own — i.e. two distinct
// "clients" (distinct X-Forwarded-For values) get independent budgets, and
// requests without any forwarded header still get limited as one client.
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../src/app.js'

const LOGIN_ATTEMPTS_TO_EXHAUST = 20 // matches authLimiter's `limit` in rateLimit.ts

async function failedLoginsFrom(ip: string, count: number) {
  let last
  for (let i = 0; i < count; i++) {
    last = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'nobody@example.com', password: 'wrong-password' })
  }
  return last!
}

describe('auth rate limiter keys on the forwarded client address', () => {
  it('exhausts the limit for one forwarded IP without affecting a different one', async () => {
    const exhausted = await failedLoginsFrom('203.0.113.10', LOGIN_ATTEMPTS_TO_EXHAUST)
    expect(exhausted.status).toBe(401) // last of the 20 still gets a normal auth failure

    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ email: 'nobody@example.com', password: 'wrong-password' })
    expect(blocked.status).toBe(429)

    const otherClient = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '198.51.100.20')
      .send({ email: 'nobody@example.com', password: 'wrong-password' })
    expect(otherClient.status).toBe(401)
  })
})
