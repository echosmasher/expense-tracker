import { describe, it, expect } from 'vitest'
import { homeOre, deriveRate, distributeResidual, parseQuote } from './convert.js'

describe('homeOre', () => {
  it('converts 12.50 EUR at 11.6543 (worked example from the plan)', () => {
    // 1250 minor units × 11_654_300 / 10^6 = 14567.875 → 14568 øre
    expect(homeOre(1250, 11_654_300n, 2)).toBe(14568)
  })

  it('converts 1000 JPY at a per-100 derived rate (worked example from the plan)', () => {
    // 1000 × 71234 / 10^4 = 7123.4 → 7123 øre
    expect(homeOre(1000, 71_234n, 0)).toBe(7123)
  })

  it('rounds an exact half up', () => {
    // 1 minor unit × 500000 / 10^6 = 0.5 → rounds up to 1
    expect(homeOre(1, 500_000n, 2)).toBe(1)
  })

  it('rounds just below a half down', () => {
    expect(homeOre(1, 499_999n, 2)).toBe(0)
  })

  it('rounds a very small amount to zero øre without throwing', () => {
    expect(homeOre(1, 1n, 2)).toBe(0)
  })

  it('handles a zero-exponent currency (JPY)', () => {
    // 1 JPY at 1.00 NOK/JPY = 100 øre exactly.
    expect(homeOre(1, 1_000_000n, 0)).toBe(100)
  })

  it('converting a line total directly can differ from converting the unit price and multiplying by quantity — callers must convert the total, never unit × quantity', () => {
    // 1 minor unit × 7, at 1.65 NOK/unit: unit conversion rounds to 2 øre
    // (2×7=14), but the total's direct conversion is 12 øre. Per the money
    // model, total_price_ore must be homeOre(originalTotalMinor, ...), never
    // homeOre(originalUnitMinor, ...) × quantity.
    const rate = 1_650_000n
    const unitConverted = homeOre(1, rate, 2)
    const totalConverted = homeOre(1 * 7, rate, 2)
    expect(unitConverted * 7).toBe(14)
    expect(totalConverted).toBe(12)
    expect(unitConverted * 7).not.toBe(totalConverted)
  })
})

describe('deriveRate', () => {
  it('derives the rate implied by an actual charged amount and reconverts to the same total', () => {
    const originalTotalMinor = 1250 // 12.50 EUR
    const actualOre = 14_600 // card issuer charged slightly more than the reference rate implied
    const rate = deriveRate(actualOre, originalTotalMinor, 2)
    // Reconverting at the derived rate should land at or within a rounding
    // unit of the actual amount (the residual rule fixes the remainder up).
    const reconverted = homeOre(originalTotalMinor, rate, 2)
    expect(Math.abs(reconverted - actualOre)).toBeLessThanOrEqual(1)
  })

  it('throws for a zero original total', () => {
    expect(() => deriveRate(1000, 0, 2)).toThrow()
  })
})

describe('distributeResidual', () => {
  it('adds the residual to the largest non-personal line', () => {
    const lines = [
      { totalPriceOre: 100, isPersonal: false },
      { totalPriceOre: 500, isPersonal: false },
      { totalPriceOre: 900, isPersonal: true },
    ]
    const result = distributeResidual(lines, 7)
    expect(result[1]!.totalPriceOre).toBe(507)
    expect(result[0]!.totalPriceOre).toBe(100)
    expect(result[2]!.totalPriceOre).toBe(900)
  })

  it('falls back to the largest line overall when every line is personal', () => {
    const lines = [
      { totalPriceOre: 100, isPersonal: true },
      { totalPriceOre: 500, isPersonal: true },
    ]
    const result = distributeResidual(lines, 3)
    expect(result[1]!.totalPriceOre).toBe(503)
  })

  it('is a no-op for a zero residual', () => {
    const lines = [{ totalPriceOre: 100, isPersonal: false }]
    expect(distributeResidual(lines, 0)).toBe(lines)
  })
})

describe('parseQuote', () => {
  it('parses a per-1 quote (EUR)', () => {
    expect(parseQuote('11.6543', 1)).toBe(11_654_300n)
  })

  it('parses a per-100 quote (JPY)', () => {
    expect(parseQuote('7.1234', 100)).toBe(71_234n)
  })

  it('parses a whole-number quote with no fractional part', () => {
    expect(parseQuote('12', 1)).toBe(12_000_000n)
  })

  it('rejects a non-numeric string rather than silently truncating it', () => {
    expect(() => parseQuote('not-a-number', 1)).toThrow()
  })
})
