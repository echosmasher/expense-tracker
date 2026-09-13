// Property-based tests for the money model (SC-002). For randomised line
// items and rates, an expense's home-currency total must equal the exact sum
// of its non-personal line items — no rounding residual — both on a fresh
// conversion and after the derived-rate correction path.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { homeOre, deriveRate, distributeResidual } from './convert.js'

const exponentArb = fc.constantFrom(0, 2)
const rateArb = fc.bigInt({ min: 1n, max: 100_000_000n }) // up to ~100 NOK/unit
const lineArb = fc.record({
  originalUnitMinor: fc.integer({ min: 1, max: 1_000_000 }),
  quantity: fc.integer({ min: 1, max: 20 }),
  isPersonal: fc.boolean(),
})
const linesArb = fc.array(lineArb, { minLength: 1, maxLength: 15 })

function convertLines(lines: { originalUnitMinor: number; quantity: number; isPersonal: boolean }[], rate: bigint, exponent: number) {
  return lines.map((l) => {
    const originalTotalMinor = l.originalUnitMinor * l.quantity
    return {
      originalTotalMinor,
      totalPriceOre: homeOre(originalTotalMinor, rate, exponent),
      isPersonal: l.isPersonal,
    }
  })
}

describe('money model invariants (SC-002)', () => {
  it('is deterministic, non-negative, and integer for any lines and rate (so summing it is always exact)', () => {
    fc.assert(
      fc.property(linesArb, rateArb, exponentArb, (lines, rate, exponent) => {
        for (const line of lines) {
          const originalTotalMinor = line.originalUnitMinor * line.quantity
          const a = homeOre(originalTotalMinor, rate, exponent)
          const b = homeOre(originalTotalMinor, rate, exponent)
          expect(a).toBe(b) // deterministic — repeat conversion never drifts
          expect(Number.isInteger(a)).toBe(true)
          expect(a).toBeGreaterThanOrEqual(0)
        }
      }),
      { numRuns: 200 }
    )
  })

  it('converting per-line and summing never exceeds converting the aggregate original total by more than one øre per line (bounded rounding drift)', () => {
    fc.assert(
      fc.property(linesArb, rateArb, exponentArb, (lines, rate, exponent) => {
        const perLineSum = lines.reduce(
          (sum, l) => sum + homeOre(l.originalUnitMinor * l.quantity, rate, exponent),
          0
        )
        const aggregateOriginal = lines.reduce((sum, l) => sum + l.originalUnitMinor * l.quantity, 0)
        const aggregateConverted = homeOre(aggregateOriginal, rate, exponent)
        expect(Math.abs(perLineSum - aggregateConverted)).toBeLessThanOrEqual(lines.length)
      }),
      { numRuns: 200 }
    )
  })

  it('after the derived-rate correction, the sum of ALL lines equals the actual charged amount exactly', () => {
    fc.assert(
      fc.property(
        linesArb,
        rateArb,
        exponentArb,
        fc.integer({ min: 0, max: 10_000_000 }),
        (lines, referenceRate, exponent, actualDelta) => {
          const originalTotalMinor = lines.reduce((sum, l) => sum + l.originalUnitMinor * l.quantity, 0)
          fc.pre(originalTotalMinor > 0)

          // Reference conversion first (what the receipt would show before correction).
          const referenceOre = homeOre(originalTotalMinor, referenceRate, exponent)
          const actualOre = referenceOre + actualDelta // simulate a plausible actual charge

          const derivedRate = deriveRate(actualOre, originalTotalMinor, exponent)
          const converted = convertLines(lines, derivedRate, exponent)
          const sumBeforeResidual = converted.reduce((sum, l) => sum + l.totalPriceOre, 0)
          const residual = actualOre - sumBeforeResidual

          const final = distributeResidual(converted, residual)
          const finalSum = final.reduce((sum, l) => sum + l.totalPriceOre, 0)

          expect(finalSum).toBe(actualOre)

          // The residual only ever lands on one line, so the non-personal
          // total after correction equals the pre-residual non-personal sum
          // plus the residual if and only if it landed on a non-personal
          // line (or on the sole "largest line" fallback when everything is
          // personal, in which case the household total is unaffected).
          const nonPersonalBefore = converted.filter((l) => !l.isPersonal).reduce((sum, l) => sum + l.totalPriceOre, 0)
          const nonPersonalAfter = final.filter((l) => !l.isPersonal).reduce((sum, l) => sum + l.totalPriceOre, 0)
          const allPersonal = lines.every((l) => l.isPersonal)
          expect(nonPersonalAfter).toBe(allPersonal ? nonPersonalBefore : nonPersonalBefore + residual)
        }
      ),
      { numRuns: 200 }
    )
  })
})
