/**
 * Push notification service — Expo push notifications (APNs).
 * Sends `settlement.ready` alerts to all registered iOS devices in a household.
 *
 * Tokens are stored in a separate `expo_push_tokens` table (V2 migration).
 * This service gracefully no-ops if the table doesn't exist or Expo endpoint is unreachable.
 */

interface ExpoMessage {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export async function sendSettlementReadyPush(params: {
  householdId: string
  householdName: string
  settlementId: string
  tokens: string[]
}): Promise<void> {
  if (params.tokens.length === 0) return

  const messages: ExpoMessage[] = params.tokens.map((token) => ({
    to: token,
    title: `${params.householdName} — Settlement ready`,
    body: 'Monthly expenses have been calculated. Tap to view and settle up.',
    data: { settlementId: params.settlementId, householdId: params.householdId },
  }))

  try {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    })
  } catch {
    // Non-fatal: push delivery failure should never block the settlement flow
  }
}

/**
 * Fetch all Expo push tokens for members of a household.
 * Returns empty array if table does not exist (pre-migration environments).
 */
export async function getHouseholdPushTokens(
  householdId: string,
  db: import('../db/client.js').DbClient
): Promise<string[]> {
  try {
    const result = await db.query<{ token: string }>(
      `SELECT ept.token FROM expo_push_tokens ept
       JOIN household_members hm ON hm.user_id = ept.user_id
       WHERE hm.household_id = $1`,
      [householdId]
    )
    return result.rows.map((r) => r.token)
  } catch {
    return []
  }
}
