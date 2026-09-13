/**
 * Foreign-currency conversion — pure integer (BigInt) arithmetic, no
 * floating-point value is ever computed or persisted. See
 * specs/005-multi-currency/plan.md "Money Model" for the derivation.
 *
 * Rate scale: `rateScaled` is NOK per ONE unit of the foreign currency,
 * multiplied by 10^6 (BigInt).
 */

/** (n + d/2) / d, integer division — round-half-up for non-negative n, d > 0. */
function roundHalfUpDiv(n: bigint, d: bigint): bigint {
  return (n + d / 2n) / d
}

/**
 * Convert an amount in a foreign currency's minor unit to whole øre.
 *
 * homeOre = roundHalfUp( originalMinor × rateScaled / 10^(exp + 4) )
 */
export function homeOre(originalMinor: number | bigint, rateScaled: bigint, exponent: number): number {
  const n = BigInt(originalMinor) * rateScaled
  const d = 10n ** BigInt(exponent + 4)
  return Number(roundHalfUpDiv(n, d))
}

/**
 * Derive the scaled rate implied by the actual home-currency amount charged
 * for the whole receipt.
 *
 * rateScaled = roundHalfUp( actualOre × 10^(exp + 4) / originalTotalMinor )
 */
export function deriveRate(actualHomeTotalOre: number | bigint, originalTotalMinor: number | bigint, exponent: number): bigint {
  const originalTotal = BigInt(originalTotalMinor)
  if (originalTotal === 0n) throw new Error('Cannot derive a rate with zero original total')
  const n = BigInt(actualHomeTotalOre) * 10n ** BigInt(exponent + 4)
  return roundHalfUpDiv(n, originalTotal)
}

export interface ResidualLine {
  totalPriceOre: number
  isPersonal: boolean
}

/**
 * Assign a rounding residual (actualOre − Σ converted lines) to the largest
 * non-personal line, or the largest line overall if every line is personal.
 * Returns a new array; input is untouched.
 */
export function distributeResidual<T extends ResidualLine>(lines: T[], residualOre: number): T[] {
  if (residualOre === 0 || lines.length === 0) return lines

  const nonPersonal = lines.filter((l) => !l.isPersonal)
  const pool = nonPersonal.length > 0 ? nonPersonal : lines
  const target = pool.reduce((max, l) => (l.totalPriceOre > max.totalPriceOre ? l : max), pool[0]!)

  return lines.map((l) => (l === target ? { ...l, totalPriceOre: l.totalPriceOre + residualOre } : l))
}

/**
 * Parse a Norges Bank decimal-string quote (e.g. "11.6543") into a scaled
 * rate (NOK per one unit × 10^6), using integer string arithmetic — never
 * `parseFloat`. `unitMult` is how many units of the currency the quote
 * covers (1, or 100 for currencies Norges Bank quotes per 100 units).
 */
export function parseQuote(quote: string, unitMult: number): bigint {
  const trimmed = quote.trim()
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed)
  if (!match) throw new Error(`Invalid quote string: ${quote}`)
  const [, intPart, fracPart = ''] = match

  const scaledValue = BigInt(intPart! + fracPart)
  const fracLen = BigInt(fracPart.length)

  const numerator = scaledValue * 10n ** 6n
  const denominator = 10n ** fracLen * BigInt(unitMult)

  return roundHalfUpDiv(numerator, denominator)
}
