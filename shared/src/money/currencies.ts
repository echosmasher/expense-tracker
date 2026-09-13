/**
 * Currencies supported for foreign-currency expenses: NOK (the fixed home
 * currency) plus every currency Norges Bank publishes a daily NOK rate for.
 *
 * `exponent` is the number of minor-unit digits this app uses for the
 * currency (JPY, ISK and HUF are treated as zero-decimal, per the app's
 * money model — not necessarily ISO 4217's decimal count).
 *
 * `unitMult` is how many units of the currency Norges Bank's published quote
 * covers (1, or 100 for low-value currencies). It is NOT derivable from the
 * API response — Norges Bank's SDMX-JSON series carries no UNIT_MULT
 * dimension — so it is hardcoded here from the published rate list.
 */
export interface CurrencyInfo {
  code: string
  exponent: number
  unitMult: number
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  NOK: { code: 'NOK', exponent: 2, unitMult: 1 },
  EUR: { code: 'EUR', exponent: 2, unitMult: 1 },
  USD: { code: 'USD', exponent: 2, unitMult: 1 },
  GBP: { code: 'GBP', exponent: 2, unitMult: 1 },
  SEK: { code: 'SEK', exponent: 2, unitMult: 1 },
  DKK: { code: 'DKK', exponent: 2, unitMult: 1 },
  PLN: { code: 'PLN', exponent: 2, unitMult: 1 },
  CHF: { code: 'CHF', exponent: 2, unitMult: 1 },
  CAD: { code: 'CAD', exponent: 2, unitMult: 1 },
  AUD: { code: 'AUD', exponent: 2, unitMult: 1 },
  NZD: { code: 'NZD', exponent: 2, unitMult: 1 },
  CZK: { code: 'CZK', exponent: 2, unitMult: 1 },
  HKD: { code: 'HKD', exponent: 2, unitMult: 1 },
  SGD: { code: 'SGD', exponent: 2, unitMult: 1 },
  ZAR: { code: 'ZAR', exponent: 2, unitMult: 1 },
  TRY: { code: 'TRY', exponent: 2, unitMult: 1 },
  CNY: { code: 'CNY', exponent: 2, unitMult: 1 },
  INR: { code: 'INR', exponent: 2, unitMult: 1 },
  ILS: { code: 'ILS', exponent: 2, unitMult: 1 },
  MXN: { code: 'MXN', exponent: 2, unitMult: 1 },
  MYR: { code: 'MYR', exponent: 2, unitMult: 1 },
  PHP: { code: 'PHP', exponent: 2, unitMult: 1 },
  RON: { code: 'RON', exponent: 2, unitMult: 1 },
  BGN: { code: 'BGN', exponent: 2, unitMult: 1 },
  BRL: { code: 'BRL', exponent: 2, unitMult: 1 },
  THB: { code: 'THB', exponent: 2, unitMult: 1 },
  JPY: { code: 'JPY', exponent: 0, unitMult: 100 },
  ISK: { code: 'ISK', exponent: 0, unitMult: 100 },
  HUF: { code: 'HUF', exponent: 0, unitMult: 100 },
  KRW: { code: 'KRW', exponent: 0, unitMult: 100 },
  IDR: { code: 'IDR', exponent: 0, unitMult: 100 },
}

export function getCurrency(code: string): CurrencyInfo | undefined {
  return CURRENCIES[code]
}

export function isKnownCurrency(code: string): boolean {
  return code in CURRENCIES
}
