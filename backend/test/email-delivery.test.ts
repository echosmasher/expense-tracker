// email.ts must never let a failed send pass silently: Resend returns
// { error } instead of throwing, so the service has to look at it. It must
// also never throw — callers have already committed their database changes.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const send = vi.hoisted(() => vi.fn())
vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

const logError = vi.hoisted(() => vi.fn())
vi.mock('../src/logger.js', () => ({
  logger: { error: logError, warn: vi.fn(), info: vi.fn() },
}))

import { sendInviteEmail, sendSettlementReadyEmail } from '../src/services/email.js'

const invite = { to: 'new@example.com', token: 'raw-token', householdName: 'Home' }
const settlement = {
  to: ['a@example.com', 'b@example.com'],
  householdName: 'Home',
  periodLabel: 'July',
  transactions: [{ fromName: 'A', toName: 'B', amountOre: 12_345 }],
}

beforeEach(() => {
  send.mockReset()
  logError.mockReset()
})

describe('email delivery', () => {
  it('sends an invite without logging an error on success', async () => {
    send.mockResolvedValue({ data: { id: 'e1' }, error: null })
    await sendInviteEmail(invite)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0]).toMatchObject({ to: 'new@example.com' })
    expect(logError).not.toHaveBeenCalled()
  })

  it('logs a returned Resend error for an invite and does not throw', async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'domain not verified', statusCode: 403 },
    })
    await expect(sendInviteEmail(invite)).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledTimes(1)
    const [fields, message] = logError.mock.calls[0]!
    expect(fields).toMatchObject({ kind: 'invite', emailError: { message: 'domain not verified' } })
    expect(message).toBe('Email delivery failed')
  })

  it('does not put the invite token in the log line', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'x', message: 'bad', statusCode: 500 } })
    await sendInviteEmail(invite)
    expect(JSON.stringify(logError.mock.calls)).not.toContain('raw-token')
  })

  it('logs a returned Resend error for a settlement email and does not throw', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', message: 'slow down', statusCode: 429 } })
    await expect(sendSettlementReadyEmail(settlement)).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledTimes(1)
    expect(logError.mock.calls[0]![0]).toMatchObject({ kind: 'settlement-ready' })
  })

  it('logs and swallows a thrown network failure', async () => {
    send.mockRejectedValue(new Error('network down'))
    await expect(sendSettlementReadyEmail(settlement)).resolves.toBeUndefined()

    expect(logError).toHaveBeenCalledTimes(1)
    expect(logError.mock.calls[0]![0]).toMatchObject({ kind: 'settlement-ready' })
  })
})
