import { CURRENCIES } from './currencies.js'

/** Format a minor-unit integer amount in its own currency, e.g. `formatMinor(1250, 'EUR')` → "12.50 EUR". */
export function formatMinor(amountMinor: number, currency: string): string {
  const exponent = CURRENCIES[currency]?.exponent ?? 2
  if (exponent === 0) return `${amountMinor} ${currency}`
  const divisor = 10 ** exponent
  const whole = Math.trunc(amountMinor / divisor)
  const fraction = Math.abs(amountMinor % divisor).toString().padStart(exponent, '0')
  return `${whole}.${fraction} ${currency}`
}
