import { Resend } from 'resend'
import { logger } from '../logger.js'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.EMAIL_FROM ?? 'noreply@expensetracker.app'
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'

/**
 * Send one email, logging any failure instead of dropping it.
 *
 * Resend reports delivery problems (unverified domain, bad API key, rate
 * limit) by *returning* `{ error }` rather than throwing, so a bare
 * `await resend.emails.send(...)` makes a failed send look like a success.
 * This never throws either: both callers have already committed their
 * database changes (the invite row, the settlement) by the time the email
 * goes out, so failing the request would leave a created-but-"errored"
 * record and tempt a retry. The failure is logged at error level instead —
 * `docker compose logs api | grep "Email delivery failed"`.
 */
async function deliver(
  kind: 'invite' | 'settlement-ready',
  message: Parameters<typeof resend.emails.send>[0]
): Promise<void> {
  try {
    const { error } = await resend.emails.send(message)
    if (error) logger.error({ kind, emailError: error }, 'Email delivery failed')
  } catch (err) {
    logger.error({ kind, err }, 'Email delivery failed')
  }
}

// ─── Invite email ────────────────────────────────────────────────────────────

export async function sendInviteEmail(params: {
  to: string
  token: string
  householdName: string
}): Promise<void> {
  const link = `${APP_URL}/accept-invite?token=${params.token}`

  if (process.env.NODE_ENV !== 'production') {
    // Local-dev convenience: print the invite link so it can be opened without
    // relying on Resend delivery to an unverified domain.
    console.log(`[invite] ${params.to} → ${link}`)
  }

  await deliver('invite', {
    from: FROM,
    to: params.to,
    subject: `You've been invited to join ${params.householdName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>You're invited!</h2>
        <p>You've been invited to join <strong>${params.householdName}</strong> on Expense Tracker.</p>
        <p>
          <a href="${link}"
             style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">
            Accept Invite
          </a>
        </p>
        <p style="color:#6b7280;font-size:14px;">This link expires in 7 days.</p>
      </div>
    `,
    text: `You've been invited to join ${params.householdName} on Expense Tracker.\n\nAccept here: ${link}\n\nThis link expires in 7 days.`,
  })
}

// ─── Settlement ready email ───────────────────────────────────────────────────

export async function sendSettlementReadyEmail(params: {
  to: string[]
  householdName: string
  periodLabel: string
  transactions: Array<{ fromName: string; toName: string; amountOre: number }>
}): Promise<void> {
  const formatNok = (ore: number) =>
    `kr ${(ore / 100).toLocaleString('nb-NO', { minimumFractionDigits: 2 })}`

  const txLines = params.transactions
    .map((t) => `<li>${t.fromName} → ${t.toName}: <strong>${formatNok(t.amountOre)}</strong></li>`)
    .join('')

  const settleUrl = `${APP_URL}/settlement`

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[settlement] ${params.to.join(', ')} → ${settleUrl}`)
  }

  await deliver('settlement-ready', {
    from: FROM,
    to: params.to,
    subject: `Settlement ready for ${params.householdName} — ${params.periodLabel}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Settlement ready</h2>
        <p><strong>${params.householdName}</strong> — ${params.periodLabel}</p>
        <ul>${txLines}</ul>
        <p>
          <a href="${settleUrl}"
             style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">
            View &amp; settle
          </a>
        </p>
      </div>
    `,
    text: `Settlement ready for ${params.householdName} — ${params.periodLabel}\n\n${
      params.transactions.map((t) => `${t.fromName} → ${t.toName}: ${formatNok(t.amountOre)}`).join('\n')
    }\n\nView at: ${settleUrl}`,
  })
}
