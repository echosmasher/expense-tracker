# Feature Specification: Multi-Currency Expenses & Trip Dashboard

**Feature Branch**: `005-multi-currency`
**Created**: 2026-08-31
**Status**: Draft
**Depends on**: 001-expense-tracker-app (expenses, line items, projects), 003-decouple-settlement (settlement snapshots), 004-mobile-client (on-the-go capture)

---

## Summary

Every monetary value in the system is an integer in øre and is implicitly Norwegian kroner. There is
no currency concept anywhere — not in the schema, not in the shared calculation code, not in the
receipt parser. A receipt from a trip abroad can only be entered by doing the conversion in your
head first, and once entered, the fact that it was ever a foreign amount is gone.

This spec introduces currency as a first-class property of an expense. An expense records the amount
exactly as printed on the receipt, in the currency printed on the receipt, together with the exchange
rate used and the resulting home-currency amount. The home-currency amount is what everything
downstream — settlement, statistics, balances — continues to operate on, unchanged.

It also adds a project-level trip view: what the trip has cost so far in both currencies, and who
currently owes whom, without having to close a settlement to find out.

## Business Value

A shared trip is the case where an expense tracker earns its keep and where manual reconstruction is
worst: dozens of small expenses, several currencies, two people paying at random, and a settlement
weeks later that nobody can verify. Recording the original amount is what makes those expenses
checkable against a card statement afterwards — a converted-only figure can never be reconciled with
anything.

Seeing the running balance during the trip means it can be settled while the details are still
fresh, rather than becoming an archaeology exercise on the flight home.

---

## User Stories

### User Story 1 -- Record a Foreign-Currency Expense (Priority: P1)

A member scans a receipt in euros. The system recognises the currency, fetches the day's exchange
rate, and records both the euro amount from the receipt and the equivalent home-currency amount. The
member confirms the currency before the expense is saved.

**Why this priority**: Everything else in this spec depends on a foreign-currency expense existing.

**Independent Test**: Scan a euro receipt and confirm the saved expense shows both the euro total and
a home-currency total, with the rate recorded.

**Acceptance Scenarios**:

1. **Given** a receipt printed in a foreign currency, **When** it is parsed, **Then** the detected
   currency is offered on the review screen — pre-selected, never silently applied.
2. **Given** the review screen, **Then** the member can change the currency, and every amount on the
   screen is understood to be in the selected currency.
3. **Given** an expense being created inside a project that has a default currency, **Then** that
   currency is pre-selected when the receipt provides none.
4. **Given** a member confirms an expense in a foreign currency, **Then** the system records, for
   that expense: the original currency, the original amounts, the exchange rate applied, the moment
   the rate was captured, and the derived home-currency amounts.
5. **Given** a confirmed foreign-currency expense, **When** any member views it, **Then** both the
   original amount and the home-currency amount are shown, together with the rate used.
6. **Given** an expense in the household's home currency, **Then** the flow is unchanged from today
   and no rate, conversion, or second amount is shown anywhere.
7. **Given** every existing expense created before this feature, **Then** it is treated as being in
   the home currency and its stored amounts are unchanged.
8. **Given** the exchange-rate source is unavailable, **Then** the expense can still be created —
   using the most recent known rate, or a rate the member enters by hand — and it is recorded which
   of these happened.
9. **Given** a member is offline and creating an expense from a queued capture, **Then** the rate is
   resolved when the capture is flushed, not at capture time.

---

### User Story 2 -- The Recorded Rate Is Correctable (Priority: P1)

The rate the app applies is a reference rate. The card issuer applies its own rate plus a margin, so
the real charge differs. When the actual charge appears on the statement, the member corrects the
expense and the home-currency amount is recalculated.

**Why this priority**: Without correction, every foreign expense in the system is permanently
slightly wrong, and the settlement built on it is wrong by the same margin. This is the difference
between a record and an estimate.

**Independent Test**: Create a foreign expense, correct its rate, and confirm the home-currency total
and any open settlement balance both change accordingly.

**Acceptance Scenarios**:

1. **Given** an unsettled foreign-currency expense, **When** a member corrects the exchange rate,
   **Then** the home-currency amounts are recalculated and the original amounts are untouched.
2. **Given** an unsettled foreign-currency expense, **When** a member instead enters the actual
   home-currency amount charged, **Then** the effective rate is derived and stored, and the original
   amount is untouched.
3. **Given** a corrected expense, **Then** it is visibly marked as having a corrected rather than a
   fetched rate.
4. **Given** an expense already included in a closed settlement, **When** a member attempts to
   correct its rate, **Then** the request is rejected — a settled amount is immutable.
5. **Given** an expense included in an open settlement, **When** its rate is corrected, **Then** the
   correction is either rejected or the open settlement's balances are recomputed — never silently
   left inconsistent with the expense.
6. **Given** a correction, **Then** it does not alter any other expense, including other expenses in
   the same currency on the same date.

---

### User Story 3 -- Trip Dashboard (Priority: P1)

A member opens a project during a trip and sees what it has cost so far — in the home currency and
broken down by the currencies actually spent — plus who currently owes whom, without triggering a
settlement.

**Why this priority**: This is what makes the data useful during the trip rather than after it.

**Independent Test**: Add expenses in two currencies paid by two different members and confirm the
project view shows correct totals and a correct provisional balance.

**Acceptance Scenarios**:

1. **Given** a project with expenses, **When** a member opens it, **Then** the total spent so far is
   shown in the home currency.
2. **Given** a project with expenses in more than one currency, **Then** the totals are also broken
   down per original currency.
3. **Given** a project with expenses paid by different members, **Then** the view shows the
   provisional balance per member and the transfers that would settle it.
4. **Given** the provisional balance, **Then** it is computed by the existing settlement calculation
   with no change to that calculation, and is clearly marked as provisional.
5. **Given** a project with no expenses, **Then** the view shows an empty state rather than a zeroed
   balance sheet.
6. **Given** a project settlement is subsequently triggered, **Then** the settlement it produces
   matches the provisional balance shown immediately beforehand, given the same expenses.
7. **Given** the project view on a phone, **Then** it is usable at phone width per spec 004.

---

### User Story 4 -- Home-Currency Amounts Stay Authoritative (Priority: P1)

Settlement, statistics, and every balance continue to operate purely on home-currency amounts.
Introducing currency changes what is *displayed* and what is *recorded*, never how money is split.

**Why this priority**: The settlement algorithm and its integer invariants are the correctness core
of the application. This story exists to pin that this feature does not disturb them.

**Independent Test**: Run the existing settlement and statistics suites unchanged against a dataset
containing foreign-currency expenses.

**Acceptance Scenarios**:

1. **Given** a household containing foreign-currency expenses, **When** a settlement is triggered,
   **Then** all balances and transfers are in the home currency only.
2. **Given** a settlement, **Then** its snapshot fixes the home-currency amounts as they stood at
   trigger time, and no later rate movement changes a settled figure.
3. **Given** statistics for any period, **Then** all totals are in the home currency and foreign
   expenses are included at their recorded home-currency value.
4. **Given** a settled foreign expense, **Then** its recorded rate and original amount remain
   visible for reference indefinitely.
5. **Given** the settlement calculation, **Then** it receives no currency information and requires no
   change.
6. **Given** any conversion, **Then** it is performed with integer arithmetic and the result is an
   integer number of øre.
7. **Given** an expense with several line items, **Then** its home-currency total equals the sum of
   its line items' home-currency amounts exactly, with no residual discrepancy.

---

## Edge Cases

- A receipt shows two currencies (e.g. a dynamic-currency-conversion slip showing both EUR and NOK).
  The member chooses which one the expense is recorded in; the app does not guess.
- The parser reports a currency that is not supported by the rate source. The expense can still be
  created with a manually entered rate.
- An expense is dated before the earliest available rate, or on a weekend or holiday when no
  reference rate was published. The nearest preceding published rate is used, and which date's rate
  was applied is recorded.
- The rate source returns an implausible value. The stored rate is whatever was applied, and the
  member can correct it per User Story 2.
- A rate is corrected on an expense whose line items were also edited. The original amounts and the
  rate are independent inputs; the home-currency amounts derive from both.
- An expense is moved between a project and a household, or between projects with different default
  currencies. Its own recorded currency and rate travel with it and are not re-derived.
- A trip's expenses are split across a project and the general household. The trip dashboard reports
  only the project's expenses.
- Conversion of a very small amount rounds to zero øre. The conversion result is still recorded, and
  the line-item sum invariant still holds.
- Two members hold different home currencies. Out of scope — the home currency is a property of the
  household, not the member.

---

## Out of Scope (V1)

- Per-member home currencies. One home currency per household.
- Settling in any currency other than the home currency.
- Historical rate charts, rate alerts, or any rate display outside an expense or the trip dashboard.
- Automatic re-conversion of any expense when rates move. Rates are captured once and only ever
  change by explicit correction.
- Importing card or bank statements to reconcile charges automatically.
- Per-expense fee or card-margin modelling beyond the single correctable rate.
- Cryptocurrency and non-ISO currencies.
- Changing the home currency of an existing household, or backfilling currency onto expenses created
  before this feature.
- Budgets and per-category spending targets.
- Trip-level extras beyond totals and provisional balances: itineraries, per-day breakdowns, and
  per-member spend caps.

---

## Non-Functional Requirements

- All monetary values MUST remain integers in øre. Exchange rates MUST be stored as scaled integers,
  and conversion MUST be integer arithmetic — no floating-point value is ever persisted or used to
  compute a stored amount.
- The rounding rule for conversion MUST be defined once, applied consistently, and covered by tests
  including exact-half cases.
- Conversion MUST be applied per line item, with an expense's home-currency total derived as the sum
  of its converted line items — so the existing per-line-item split behaviour cannot produce totals
  that disagree with the expense.
- `shared/src/calc/settlement.ts` MUST NOT change. Its existing unit and property tests MUST pass
  untouched.
- A rate, once applied to an expense, MUST NOT change except by explicit correction, and MUST NOT
  change at all once the expense is settled.
- Rates MUST be fetched server-side and cached, so that repeated expense creation on the same day
  does not repeatedly call the rate source, and so no API credential reaches a client.
- Rate-source failure MUST degrade — never block expense creation.
- Any new route MUST have an entry in `AUTHORIZATION.md` and a negative cross-household test, per
  project convention.
- The migration MUST leave every existing expense's stored amounts byte-identical, and MUST be
  reversible in the sense that no existing value is overwritten.

---

## Success Criteria

- **SC-001**: A euro receipt scanned abroad produces an expense showing the euro total from the
  receipt, the home-currency total, and the rate used. Verified end to end on a device.
- **SC-002**: For every expense, the home-currency total equals the sum of its line items'
  home-currency amounts, exactly, with no rounding residual. Verified by a property-based test over
  randomised line items and rates.
- **SC-003**: Settlement and statistics output is bit-identical before and after this feature for a
  dataset containing only home-currency expenses. Verified by snapshot comparison on seed data.
- **SC-004**: The existing settlement test suites pass with `shared/src/calc/settlement.ts`
  unmodified. Verified in CI.
- **SC-005**: Correcting a rate on an unsettled expense updates its home-currency total and any
  provisional balance; attempting the same on a settled expense is rejected. Verified by integration
  test.
- **SC-006**: With the rate source unreachable, a foreign-currency expense can still be created and
  is marked as using a cached or manual rate. Verified by integration test with the source stubbed
  to fail.
- **SC-007**: The trip dashboard's provisional balance matches the settlement subsequently produced
  from the same expenses. Verified by integration test.
- **SC-008**: No floating-point value is persisted for any monetary amount or rate. Verified by
  schema review and test.

## Assumptions

- The household's home currency is NOK and is fixed. It is not user-configurable in this version.
- European Central Bank daily reference rates are an acceptable basis. Daily granularity is
  appropriate because card statements settle on a daily rate; intraday precision would be false
  precision.
- Members will correct rates only occasionally, when a charge is materially different — the
  correction path is a convenience, not a routine step.
- Receipts abroad are predominantly in one currency per trip, so a project-level default currency
  removes most of the picking.
- Spec 004 has shipped, so foreign receipts are captured on a phone at the point of purchase.
