# Implementation Plan: Multi-Currency Expenses & Trip Dashboard

**Branch**: `005-multi-currency` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

## Summary

Add currency to expenses without touching how money is split. Each expense carries a currency,
per-line original amounts, and a scaled-integer rate; each line item's home-currency total is
stored and becomes the single source every total is summed from. Rates come from Norges Bank,
cached in Postgres, resolved server-side when a draft is created or its currency changes, and
correctable (directly, or by entering the actual charged amount) until the expense enters a
settlement. A project summary endpoint reuses the shared settlement calculator to show a
provisional balance during a trip.

Tasks for this spec live as GitHub issues (label `spec:005-multi-currency`); the ticket map at the
end of this plan is the authoritative order. Ticket numbers continue from spec 004's.

## Constitution Check

Against constitution 2.0.0 (as amended by 004 Ticket 2).

| Principle | Status | Notes |
|---|---|---|
| I. API-First, Stateless Backend | PASS | Conversion, rate resolution, correction, and the provisional balance are server-side. The client only picks a currency and displays. |
| II. Self-Hosted, Docker-Native | PASS | Norges Bank is an outbound public API with no key; the rate cache is a table. No new service. |
| III. Financial Accuracy | PASS | Scaled-integer rates, BigInt conversion, half-up rounding defined once and property-tested. `settlement.ts` untouched, guarded in CI. |
| IV. Mobile-First UI | PASS | Trip dashboard and currency picker built at phone width first. |
| Migrations are additive | PASS | New columns nullable or defaulted; `total_price_ore` backfilled from existing values, never overwritten where present. |

---

## Money Model

### Definitions

- **Home currency**: `households.home_currency`, fixed `'NOK'`. Minor unit: øre.
- **Currency exponent** `exp(c)`: number of minor-unit digits (NOK, EUR, USD, GBP, SEK, DKK,
  PLN, CHF … = 2; JPY, ISK, HUF-as-published … = 0). Static map in
  `shared/src/money/currencies.ts`, restricted to the currencies Norges Bank publishes plus NOK.
- **Original amounts**: integers in the expense currency's minor unit (`*_minor`).
- **Rate** `rate_scaled`: NOK per **one** unit of the foreign currency, times 10⁶, as a BIGINT.
  1 EUR = 11.6543 NOK → `11654300`. Norges Bank quotes some currencies per 100 units
  (`UNIT_MULT = 2`); those are divided out at ingestion: 100 JPY = 7.1234 NOK → `71234`.
  Quotes are parsed from the decimal string with integer string arithmetic, never `parseFloat`.

### Conversion (one function, `shared/src/money/convert.ts`)

```
homeOre(originalMinor, rateScaled, exp) =
  roundHalfUp( originalMinor × rateScaled / 10^(exp + 4) )
```

Derivation: `originalMinor / 10^exp` units × `rateScaled / 10^6` NOK per unit × 100 øre per NOK.
Implemented with `BigInt`; `roundHalfUp(n / d) = (n + d/2) div d` for non-negative `n`.

Check: 12.50 EUR at 11.6543 → `1250 × 11654300 / 10^6 = 14567.875` → **14568 øre**.
Check: 1000 JPY at `71234` → `1000 × 71234 / 10^4 = 7123.4` → **7123 øre**.

### Per-line rule

For every expense, foreign or home, `line_items.total_price_ore` is the stored home-currency line
total and `expenses.total_amount_ore = Σ total_price_ore WHERE NOT is_personal`.

- Home currency: `total_price_ore = unit_price_ore × quantity` (unchanged arithmetic, now stored).
- Foreign: `total_price_ore = homeOre(original_total_minor, rate, exp)`, where
  `original_total_minor = original_unit_price_minor × quantity`;
  `unit_price_ore = homeOre(original_unit_price_minor, rate, exp)` for display only.

### Derived rate from the actual charged amount

Given the member enters `actualOre` for the whole receipt and the expense's
`originalTotalMinor = Σ original_total_minor` over all lines:

```
rateScaled = roundHalfUp( actualOre × 10^(exp + 4) / originalTotalMinor )
```

Reconvert every line at `rateScaled`; `residual = actualOre − Σ total_price_ore (all lines)`;
add `residual` to the largest non-personal line (largest line if none is non-personal). Store
`rate_source = 'derived'`. Invariants after: `Σ all lines = actualOre`;
`total_amount_ore = Σ non-personal lines`.

### Rate resolution (`backend/src/services/exchangeRates.ts`)

`resolveRate(currency, onDate)`:

1. Cache hit for `(currency, d)` with `d ≤ onDate` nearest → `{ rateScaled, rateDate: d, source: 'norges_bank' }` if `d` was fetched for that exact date, else `'cached'`.
2. Miss → fetch Norges Bank `EXR/B.{CUR}.NOK.SP` for `[onDate − 10 days, onDate]`, store every
   observation returned, return the latest `≤ onDate`. Fetch timeout 5 s.
3. Fetch fails and any cached rate exists for the currency → most recent, `source: 'cached'`.
4. Nothing → `null`; caller stores `rate_source = 'pending'` (drafts only) or requires a manual rate.

`onDate` = `expense_date` if set, else the draft's creation date. The API path and attribute
names are verified against the live service in the ticket; the shape above is the contract.

---

## Data Model Changes

### Migration `010_line_item_totals_authoritative.sql` (prefactor, Ticket 12)

```sql
UPDATE line_items SET total_price_ore = unit_price_ore * quantity WHERE total_price_ore IS NULL;
ALTER TABLE line_items ALTER COLUMN total_price_ore SET NOT NULL;
```

Code writes `total_price_ore` on every insert and edit; statistics sum it instead of
`unit_price_ore * quantity`. Byte-identical output for existing data (SC-003 snapshot).

### Migration `011_currency.sql` (Ticket 13)

| Table | Column | Type | Notes |
|---|---|---|---|
| `households` | `home_currency` | CHAR(3) NOT NULL DEFAULT 'NOK' | Fixed; exposed read-only. |
| `projects` | `default_currency` | CHAR(3) NULL | Pre-selects the picker. |
| `expenses` | `currency` | CHAR(3) NOT NULL DEFAULT 'NOK' | |
| `expenses` | `original_total_minor` | BIGINT NULL | Σ line originals (all lines). NULL for home currency. |
| `expenses` | `rate_scaled` | BIGINT NULL | |
| `expenses` | `rate_date` | DATE NULL | Date whose published rate was used. |
| `expenses` | `rate_source` | TEXT NULL CHECK IN ('norges_bank','cached','manual','corrected','derived','pending') | |
| `expenses` | `rate_captured_at` | TIMESTAMPTZ NULL | |
| `line_items` | `original_unit_price_minor` | BIGINT NULL | NULL for home currency. |
| `line_items` | `original_total_minor` | BIGINT NULL | `= original_unit_price_minor × quantity`. |
| `exchange_rates` (new) | `currency` CHAR(3), `rate_date` DATE, `rate_scaled` BIGINT, `source` TEXT, `fetched_at` TIMESTAMPTZ | PK `(currency, rate_date)` | Cache. |

Check constraint on `expenses`: home-currency rows have all rate columns NULL; foreign rows have
`rate_source` NOT NULL, and `rate_scaled` NOT NULL unless `rate_source = 'pending'`. A
`'pending'` row must be `pending_review` (enforced in the confirm route, not the schema).

---

## Backend Changes

### Draft creation (extends 004's `from-receipt`)

Parser returns `currency` (ISO 4217 or null) and amounts in that currency's minor unit; the
"SEK 1:1" instruction is deleted. Intake sets `currency` = parsed → project default → household
home; if foreign, resolves the rate and converts each line; if unresolved, `rate_source =
'pending'` and home amounts `0`.

### Draft editing (extends 004's routes)

- `PATCH .../expenses/:id` accepts `currency`. Changing it re-resolves the rate (unless a manual
  rate is supplied in the same call: `rateScaled` → `'manual'`) and reconverts every line.
- Line-item create/edit on a foreign draft take `originalUnitPriceMinor` instead of
  `unitPriceOre`; the server derives both home columns. Home-currency drafts are unchanged.
- `POST .../confirm` rejects `rate_source = 'pending'` with `409 RATE_PENDING`.
- `POST /households/:id/expenses` (manual entry) accepts `currency` + `rateScaled` for the rare
  hand-entered foreign expense; requires an explicit rate.

### Rate correction

`PATCH /households/:householdId/expenses/:expenseId/rate` (and project variant), body one of
`{ rateScaled }` → `'corrected'` or `{ actualHomeTotalOre }` → `'derived'`. Preconditions:
foreign currency; `status <> 'settled'`; no row in `settlement_expenses` for this expense whose
settlement is `open` (→ `409 IN_OPEN_SETTLEMENT` naming the settlement); else recompute per the
money model in one transaction. Active member of the household / project member.

### Project summary

`GET /projects/:projectId/summary` → 
```
{ homeCurrency, homeTotalOre, pendingCount,
  byCurrency: [{ currency, originalTotalMinor, homeTotalOre, expenseCount }],
  provisional: { balances: [...], transactions: [...] } | null }
```
`provisional` runs `calculateSettlement` (imported from shared, unchanged) over confirmed project
expenses with the project's allocation key; `null` when there are none. The existing
`POST /projects/:id/finish` and this endpoint share one function that builds the calculator input,
so SC-007 holds by construction and is pinned by a test.

### Responses

Expense and line-item shapes gain `currency`, `originalTotalMinor`, `rateScaled`, `rateDate`,
`rateSource`, `originalUnitPriceMinor`, `originalTotalMinor`; all `null`/absent for home
currency. Projects gain `defaultCurrency`. Households gain `homeCurrency`.

### Guarding the calculator

CI step: `git diff --quiet origin/master -- shared/src/calc/settlement.ts` on this feature's
branch, plus the existing unit and property suites.

---

## Shared Package Changes

- `shared/src/money/currencies.ts` — supported codes and exponents.
- `shared/src/money/convert.ts` — `homeOre`, `deriveRate`, `distributeResidual`, `parseQuote`
  (string → scaled BIGINT). Unit tests with exact-half cases; property test: for random lines and
  rates, `Σ non-personal = total` and, after `deriveRate`, `Σ all = actual`.
- `shared/src/money/format.ts` — `formatMinor(amount, currency)` alongside the existing NOK
  formatter.
- API client types and calls: `expenses.setRate`, `projects.summary`, currency fields.

---

## Web Changes

- **Draft review**: currency picker (home currency first, then Norges Bank list) pre-selected from
  the draft; changing it calls `PATCH` and re-renders converted amounts. Foreign drafts show each
  line in the original currency with the home amount beside it, and a rate line
  ("1 EUR = 11.6543 NOK · Norges Bank 2026-09-11" / "cached" / "manual" / "rate pending — enter
  one to confirm"). Manual rate input when pending or when the member chooses.
- **Expense detail**: original total, home total, rate line with its source badge. "Correct
  rate" action (foreign, not settled, not in an open settlement) opens a sheet with two fields:
  new rate, or actual amount charged. Corrected/derived badge afterwards.
- **Create project**: optional default currency.
- **Project detail → trip dashboard**: home total; per-currency cards; provisional balances and
  transfers marked "Provisional — not a settlement"; pending-draft count; empty state. Built at
  390pt first.
- Statistics: no change beyond consuming the same totals.

---

## Test Plan

- **Shared**: `convert` unit tests (worked examples above, exact halves, JPY exponent, zero
  rounding), property tests (sum invariants), `parseQuote` (per-1 and per-100).
- **Backend**:
  - Migration test: seed home-currency data, snapshot statistics and settlement responses before
    `010`/`011`, run, compare byte-for-byte (SC-003).
  - Rate service with the fetcher stubbed: cache hit, weekend → preceding date, fetch failure →
    cached, nothing → null; second call same day makes no fetch.
  - From-receipt with parser returning EUR: original and home amounts stored; parser returning
    unknown currency → pending; confirm on pending → 409.
  - Correction: rate and actual-amount paths recompute; settled → 409; open settlement → 409;
    other expenses untouched.
  - Project summary equals the settlement produced by `finish` on the same data (SC-007).
  - Isolation suite: `rate`, `summary` — foreign member 403/404.
- **CI**: `settlement.ts` diff guard.

## Rollout

Two additive migrations. `010` should be deployed and observed (statistics unchanged) before `011`.
No feature flag; foreign currency is opt-in per expense by construction.

---

## Ticket Map

Numbers continue from spec 004.

| # | Ticket | Blocked by | Delivers |
|---|---|---|---|
| 12 | Line-item home totals become authoritative | — | `total_price_ore` written and summed everywhere; statistics and settlements byte-identical |
| 13 | Record a foreign-currency expense with a Norges Bank rate | 12 | Schema, rate service and cache, integer conversion, manual-entry foreign expense, detail shows both amounts |
| 14 | Currency on the draft review screen | 8, 13 | Parser reports currency; draft resolves rate at creation; picker, pending rate, project default currency |
| 15 | Correct a foreign expense's rate | 13 | Rate or actual-amount correction, residual rule, badges, rejected when settled or in an open settlement |
| 16 | Trip dashboard with provisional balance | 13 | Project summary endpoint reusing the calculator; per-currency totals; phone-width project page |
