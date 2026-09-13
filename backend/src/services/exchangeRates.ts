/**
 * Norges Bank exchange rate resolution and cache (spec 005, ticket 13).
 *
 * `resolveRate` is cache-first: a database miss triggers one fetch of the
 * last ~10 days of Norges Bank observations for the currency (business days
 * only — weekends and holidays publish nothing), storing every observation
 * returned so a second lookup for the same currency+date never re-fetches.
 * A fetch failure degrades to the most recently cached rate for that
 * currency; if nothing is cached at all, resolution returns null and the
 * caller must fall back to a manual rate (or, for drafts, a pending state).
 */
import { CURRENCIES, parseQuote } from '@expense-tracker/shared'
import { db } from '../db/client.js'
import { logger } from '../logger.js'

const NORGES_BANK_BASE = 'https://data.norges-bank.no/api/data/EXR'
const FETCH_TIMEOUT_MS = 5_000
const LOOKBACK_DAYS = 10

export type RateSource = 'norges_bank' | 'cached'

export interface ResolvedRate {
  rateScaled: bigint
  rateDate: string
  source: RateSource
}

export type Fetcher = typeof fetch

interface CacheRow {
  rate_date: string
  rate_scaled: string
}

async function lookupCache(currency: string, onDate: string): Promise<ResolvedRate | null> {
  const result = await db.query<CacheRow>(
    `SELECT rate_date::text as rate_date, rate_scaled::text as rate_scaled
     FROM exchange_rates
     WHERE currency = $1 AND rate_date <= $2
     ORDER BY rate_date DESC
     LIMIT 1`,
    [currency, onDate]
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    rateScaled: BigInt(row.rate_scaled),
    rateDate: row.rate_date,
    source: row.rate_date === onDate ? 'norges_bank' : 'cached',
  }
}

async function mostRecentCached(currency: string): Promise<ResolvedRate | null> {
  const result = await db.query<CacheRow>(
    `SELECT rate_date::text as rate_date, rate_scaled::text as rate_scaled
     FROM exchange_rates
     WHERE currency = $1
     ORDER BY rate_date DESC
     LIMIT 1`,
    [currency]
  )
  const row = result.rows[0]
  if (!row) return null
  return { rateScaled: BigInt(row.rate_scaled), rateDate: row.rate_date, source: 'cached' }
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

interface NorgesBankResponse {
  data?: {
    dataSets?: Array<{
      series?: Record<string, { observations?: Record<string, [string, ...unknown[]]> }>
    }>
    structure?: {
      dimensions?: {
        observation?: Array<{ id: string; values: Array<{ id: string }> }>
      }
    }
  }
}

function extractObservations(body: NorgesBankResponse): Array<{ date: string; quote: string }> {
  const series = body.data?.dataSets?.[0]?.series
  if (!series) return []
  const seriesKey = Object.keys(series)[0]
  if (seriesKey === undefined) return []
  const observations = series[seriesKey]?.observations ?? {}
  const timeValues =
    body.data?.structure?.dimensions?.observation?.find((d) => d.id === 'TIME_PERIOD')?.values ?? []

  const result: Array<{ date: string; quote: string }> = []
  for (const [index, obs] of Object.entries(observations)) {
    const date = timeValues[Number(index)]?.id
    const quote = obs[0]
    if (date && quote) result.push({ date, quote })
  }
  return result
}

/** Fetch and cache every observation Norges Bank returns for the lookback
 * window ending on `onDate`. Throws on network failure, timeout, or a
 * non-2xx response — the caller decides how to degrade. */
async function fetchAndStore(currency: string, onDate: string, fetchImpl: Fetcher): Promise<void> {
  const info = CURRENCIES[currency]
  if (!info) return // Not a currency Norges Bank publishes; nothing to fetch.

  const startPeriod = addDays(onDate, -LOOKBACK_DAYS)
  const url = `${NORGES_BANK_BASE}/B.${currency}.NOK.SP?format=sdmx-json&startPeriod=${startPeriod}&endPeriod=${onDate}&locale=en`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let body: NorgesBankResponse
  try {
    const res = await fetchImpl(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`Norges Bank returned ${res.status} for ${currency}`)
    body = (await res.json()) as NorgesBankResponse
  } finally {
    clearTimeout(timeout)
  }

  const observations = extractObservations(body)
  for (const { date, quote } of observations) {
    const rateScaled = parseQuote(quote, info.unitMult)
    await db.query(
      `INSERT INTO exchange_rates (currency, rate_date, rate_scaled, source, fetched_at)
       VALUES ($1, $2, $3, 'norges_bank', now())
       ON CONFLICT (currency, rate_date) DO NOTHING`,
      [currency, date, rateScaled.toString()]
    )
  }
}

/**
 * Resolve the Norges Bank rate for `currency` on `onDate` (YYYY-MM-DD).
 * Returns null when nothing is known at all — the caller must require a
 * manual rate (or mark a draft's rate pending).
 */
export async function resolveRate(
  currency: string,
  onDate: string,
  fetchImpl: Fetcher = fetch
): Promise<ResolvedRate | null> {
  const cached = await lookupCache(currency, onDate)
  if (cached) return cached

  try {
    await fetchAndStore(currency, onDate, fetchImpl)
  } catch (err) {
    logger.warn({ err, currency, onDate }, 'Norges Bank rate fetch failed; degrading to cached rate')
    return mostRecentCached(currency)
  }

  const afterFetch = await lookupCache(currency, onDate)
  if (afterFetch) return afterFetch

  // Fetch succeeded but returned nothing usable (e.g. before the currency's
  // earliest published rate) — still degrade rather than fail the draft.
  return mostRecentCached(currency)
}
