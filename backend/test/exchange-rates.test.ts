// Rate service tests (spec 005, ticket 13). The Norges Bank fetch is stubbed
// via the injectable `fetchImpl` parameter — no real network call. Each test
// uses a distinct currency/date combination so rows never collide across
// tests sharing the database (currency codes must be real known currencies
// for the fetch path to actually run, so they're reused with non-overlapping
// dates rather than made up).
import { describe, it, expect, vi } from 'vitest'
import { resolveRate } from '../src/services/exchangeRates.js'
import { db } from '../src/db/client.js'

function sdmxResponse(observations: Array<[string, string]>) {
  const series: Record<string, string[]> = {}
  observations.forEach(([, quote], i) => { series[String(i)] = [quote] })
  return {
    data: {
      dataSets: [{ series: { '0:0:0:0': { observations: series } } }],
      structure: {
        dimensions: {
          observation: [
            {
              id: 'TIME_PERIOD',
              values: observations.map(([date]) => ({ id: date })),
            },
          ],
        },
      },
    },
  }
}

function okFetch(observations: Array<[string, string]>): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => sdmxResponse(observations),
  })) as unknown as typeof fetch
}

function failingFetch(): typeof fetch {
  return vi.fn(async () => { throw new Error('network down') }) as unknown as typeof fetch
}

async function currencyRowCount(currency: string): Promise<number> {
  const result = await db.query('SELECT 1 FROM exchange_rates WHERE currency = $1', [currency])
  return result.rows.length
}

describe('resolveRate', () => {
  it('fetches and caches every observation on a cache miss, resolving the exact date', async () => {
    const currency = 'EUR'
    const fetchImpl = okFetch([
      ['2026-01-05', '11.5000'],
      ['2026-01-06', '11.6000'],
    ])

    const result = await resolveRate(currency, '2026-01-06', fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result).not.toBeNull()
    expect(result!.rateDate).toBe('2026-01-06')
    expect(result!.source).toBe('norges_bank')
    expect(result!.rateScaled).toBe(11_600_000n)
    expect(await currencyRowCount(currency)).toBe(2)
  })

  it('resolves to the nearest preceding published date over a weekend gap', async () => {
    const currency = 'USD'
    // Friday published, Saturday/Sunday have no rate.
    const fetchImpl = okFetch([['2026-01-09', '11.7000']])

    const result = await resolveRate(currency, '2026-01-11', fetchImpl) // a Sunday

    expect(result).not.toBeNull()
    expect(result!.rateDate).toBe('2026-01-09')
    expect(result!.source).toBe('cached') // nearest preceding, not the exact date
  })

  it('degrades to the most recently cached rate when the fetch fails', async () => {
    const currency = 'GBP'
    // Prime the cache with a prior successful resolution.
    await resolveRate(currency, '2026-02-01', okFetch([['2026-02-01', '12.0000']]))

    const result = await resolveRate(currency, '2026-02-15', failingFetch())

    expect(result).not.toBeNull()
    expect(result!.rateDate).toBe('2026-02-01')
    expect(result!.rateScaled).toBe(12_000_000n)
    expect(result!.source).toBe('cached')
  })

  it('returns null when the fetch fails and nothing is cached', async () => {
    const currency = 'CHF'
    const result = await resolveRate(currency, '2026-03-01', failingFetch())
    expect(result).toBeNull()
  })

  it('performs no fetch on a second call for the same currency and date (SC-006)', async () => {
    const currency = 'DKK'
    const fetchImpl = okFetch([['2026-04-01', '10.0000']])

    await resolveRate(currency, '2026-04-01', fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const secondFetchImpl = vi.fn() as unknown as typeof fetch
    const second = await resolveRate(currency, '2026-04-01', secondFetchImpl)

    expect(secondFetchImpl).not.toHaveBeenCalled()
    expect(second!.rateScaled).toBe(10_000_000n)
  })

  it('parses a per-100 quote (JPY-shaped currency) using the static unit multiplier', async () => {
    const currency = 'JPY' // known currency with unitMult 100
    const fetchImpl = okFetch([['2026-05-01', '7.1234']])

    const result = await resolveRate(currency, '2026-05-01', fetchImpl)

    expect(result!.rateScaled).toBe(71_234n)
  })

  it('returns null for a currency Norges Bank does not publish, without calling fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const result = await resolveRate('ZZZ', '2026-06-01', fetchImpl)
    expect(result).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
