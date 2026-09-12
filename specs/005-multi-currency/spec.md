# Feature Specification: Multi-Currency Expenses & Trip Dashboard

**Feature Branch**: `005-multi-currency`
**Created**: 2026-08-31 · **Revised**: 2026-09-12
**Status**: Agreed (ready for tickets)
**Depends on**: 001-expense-tracker-app (expenses, line items, projects), 003-decouple-settlement (settlement snapshots), 004-mobile-client (draft-from-receipt endpoint, phone layout)
**Plan**: [plan.md](./plan.md) · **Tickets**: GitHub issues labelled `spec:005-multi-currency`

---

## Summary

Every monetary value in the system is an integer in øre and is implicitly Norwegian kroner. There is
no currency concept anywhere — not in the schema, not in the shared calculation code, not in the
receipt parser (which today tells the model to treat Swedish kronor as kroner one-to-one).
A receipt from a trip abroad can only be entered by doing the conversion in your head first, and
once entered, the fact that it was ever a foreign amount is gone.

This spec introduces currency as a first-class property of an expense. An expense records the amount
exactly as printed on the receipt, in the currency printed on the receipt, together with the exchange
rate used and the resulting home-currency amount. The home-currency amount is what everything
downstream — settlement, statistics, balances — continues to operate on, unchanged.

It also adds a project-level trip view: what the trip has cost so far in both currencies, and who
currently owes whom, without having to close a settlement to find out.

### Revision notes (2026-09-12)

Against the 2026-08-31 draft:

- **Rate source is Norges Bank, not the ECB.** The home currency is NOK; Norges Bank publishes
  daily NOK rates directly, free and without a key, so no cross-rate arithmetic is needed. Some
  currencies are quoted per 100 units; the integer scaling absorbs that.
- **The "enter the actual amount charged" correction is kept, and its rounding is defined.** The
  derived rate is stored, each line item is reconverted, and the residual is assigned to the
  largest non-personal line item so the total equals the entered amount exactly. The earlier
  draft left this contradicting the sum invariant.
- **Correcting an expense inside an open settlement is rejected**, consistent with the snapshot
  model. The draft left this open.
- **The provisional balance is computed server-side**, reusing the shared settlement calculator.
  The constitution forbids financial calculation in the client.
- **Per-line home amounts become authoritative.** The unused `total_price_ore` column becomes the
  stored home-currency line total for every expense, backfilled byte-identically for existing rows,
  so foreign conversion has one place to land and one invariant to keep.
- **Queued captures resolve their rate when the draft is created**, which with spec 004 is the
  moment of flush. If no rate can be resolved, the draft is created with a pending rate and cannot
  be confirmed until one is set.

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

A member scans a receipt in euros. The system recognises the currency, fetches the day's Norges
Bank rate, and records both the euro amount from the receipt and the equivalent home-currency
amount. The member confirms the currency before the expense is confirmed.

**Why this priority**: Everything else in this spec depends on a foreign-currency expense existing.

**Independent Test**: Scan a euro receipt and confirm the saved expense shows both the euro total and
a home-currency total, with the rate recorded.

**Acceptance Scenarios**:

1. **Given** a receipt printed in a foreign currency, **When** it is parsed, **Then** the detected
   currency is set on the draft and shown on the review screen — pre-selected, never silently
   applied — and line amounts are in that currency's minor unit.
2. **Given** the review screen, **Then** the member can change the currency, and every amount on the
   screen is understood to be in the selected currency; changing it re-resolves the rate.
3. **Given** an expense being created inside a project that has a default currency, **Then** that
   currency is pre-selected when the receipt provides none.
4. **Given** a member confirms an expense in a foreign currency, **Then** the system records, for
   that expense: the original currency, the original amounts per line item, the exchange rate
   applied, the date whose published rate was used, the moment the rate was captured, how the rate
   was obtained, and the derived home-currency amounts per line item and in total.
5. **Given** a confirmed foreign-currency expense, **When** any member views it, **Then** both the
   original amount and the home-currency amount are shown, together with the rate used.
6. **Given** an expense in the household's home currency, **Then** the flow is unchanged from today
   and no rate, conversion, or second amount is shown anywhere.
7. **Given** every existing expense created before this feature, **Then** it is treated as being in
   the home currency and its stored amounts are unchanged.
8. **Given** the rate source is unavailable, **Then** the expense can still be created — using the
   most recent known rate for that currency, or a rate the member enters by hand — and it is
   recorded which of these happened.
9. **Given** a draft created from a queued capture, **Then** the rate is resolved when the draft is
   created (at flush), not at capture time. If no rate can be resolved and nobody is present to
   enter one, the draft is created with a pending rate and cannot be confirmed until a rate is set.
10. **Given** a foreign-currency draft, **Then** it cannot be confirmed until it has a rate that is
    not pending.

---

### User Story 2 -- The Recorded Rate Is Correctable (Priority: P1)

The rate the app applies is a reference rate. The card issuer applies its own rate plus a margin, so
the real charge differs. When the actual charge appears on the statement, the member corrects the
expense and the home-currency amount is recalculated.

**Why this priority**: Without correction, every foreign expense in the system is permanently
slightly wrong, and the settlement built on it is wrong by the same margin. This is the difference
between a record and an estimate.

**Independent Test**: Create a foreign expense, correct its rate, and confirm the home-currency total
and the trip dashboard's provisional balance both change accordingly.

**Acceptance Scenarios**:

1. **Given** an unsettled foreign-currency expense not in any settlement, **When** a member corrects
   the exchange rate, **Then** every line item's home-currency amount is recalculated from its
   original amount and the new rate, the total is the sum of the lines, and the original amounts
   are untouched.
2. **Given** the same expense, **When** a member instead enters the actual home-currency amount
   charged, **Then** the effective rate is derived and stored, every line item is reconverted at
   that rate, and the rounding residual is assigned to the largest non-personal line item so the
   expense total equals the entered amount exactly. The original amounts are untouched.
3. **Given** a corrected expense, **Then** it is visibly marked as having a corrected or derived
   rather than a fetched rate.
4. **Given** an expense already included in a closed settlement, **When** a member attempts to
   correct its rate, **Then** the request is rejected — a settled amount is immutable.
5. **Given** an expense included in an open settlement, **When** a member attempts to correct its
   rate, **Then** the request is rejected with a message naming the open settlement. The open
   settlement's figures are never left inconsistent with the expense.
6. **Given** a correction, **Then** it does not alter any other expense, including other expenses in
   the same currency on the same date.
7. **Given** an expense in the home currency, **Then** there is no rate to correct and the
   correction action is not offered.

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
   down per original currency, each with its original-currency sum and its home-currency sum.
3. **Given** a project with confirmed expenses paid by different members, **Then** the view shows
   the provisional balance per member and the transfers that would settle it.
4. **Given** the provisional balance, **Then** it is computed by the server using the existing
   settlement calculation over confirmed expenses only, with no change to that calculation, and is
   clearly marked as provisional. Drafts still awaiting review are counted separately.
5. **Given** a project with no expenses, **Then** the view shows an empty state rather than a zeroed
   balance sheet.
6. **Given** a project settlement is subsequently triggered, **Then** the settlement it produces
   matches the provisional balance shown immediately beforehand, given the same confirmed expenses.
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
   trigger time, and no later rate movement or correction changes a settled figure.
3. **Given** statistics for any period, **Then** all totals are in the home currency and foreign
   expenses are included at their recorded home-currency value.
4. **Given** a settled foreign expense, **Then** its recorded rate and original amount remain
   visible for reference indefinitely.
5. **Given** the settlement calculation, **Then** it receives no currency information and requires no
   change.
6. **Given** any conversion, **Then** it is performed with integer arithmetic and the result is an
   integer number of øre.
7. **Given** any expense, foreign or home, **Then** its home-currency total equals the sum of its
   non-personal line items' stored home-currency amounts exactly, with no residual discrepancy.

---

## Edge Cases

- A receipt shows two currencies (e.g. a dynamic-currency-conversion slip showing both EUR and NOK).
  The member chooses which one the expense is recorded in; the app does not guess.
- The parser reports a currency that Norges Bank does not publish. The expense can still be
  created with a manually entered rate.
- An expense is dated before the earliest available rate, or on a weekend or holiday when no
  reference rate was published. The nearest preceding published rate is used, and which date's rate
  was applied is recorded.
- An expense has no date. The rate for the day the draft was created is used.
- The rate source returns an implausible value. The stored rate is whatever was applied, and the
  member can correct it per User Story 2.
- A rate is corrected on an expense whose line items were also edited. The original amounts and the
  rate are independent inputs; the home-currency amounts derive from both.
- A line item is added, edited, or deleted on a foreign-currency draft. Its home amount is derived
  from its original amount and the draft's current rate; the total is recomputed.
- An expense is moved between a project and a household, or between projects with different default
  currencies. Its own recorded currency and rate travel with it and are not re-derived.
- A trip's expenses are split across a project and the general household. The trip dashboard reports
  only the project's expenses.
- Conversion of a very small amount rounds to zero øre. The conversion result is still recorded, and
  the line-item sum invariant still holds.
- A currency with no minor unit (JPY) is used. Original amounts are whole units; the currency's
  exponent is part of the conversion.
- Two members hold different home currencies. Out of scope — the home currency is a property of the
  household, not the member.

## Out of Scope (V1)

- Per-member home currencies. One home currency per household.
- Changing the home currency of an existing household. The column exists, fixed to NOK.
- Settling in any currency other than the home currency.
- Historical rate charts, rate alerts, or any rate display outside an expense or the trip dashboard.
- Automatic re-conversion of any expense when rates move. Rates are captured once and only ever
  change by explicit correction.
- Importing card or bank statements to reconcile charges automatically.
- Per-expense fee or card-margin modelling beyond the single correctable rate.
- Cryptocurrency and non-ISO currencies; currencies Norges Bank does not publish, except by
  manual rate.
- Backfilling currency onto expenses created before this feature.
- Budgets and per-category spending targets.
- Trip-level extras beyond totals and provisional balances: itineraries, per-day breakdowns, and
  per-member spend caps.

## Non-Functional Requirements

- All monetary values MUST remain integers in the minor unit. Exchange rates MUST be stored as
  scaled integers, and conversion MUST be integer arithmetic — no floating-point value is ever
  persisted or used to compute a stored amount.
- The rounding rule for conversion MUST be defined once, applied consistently, and covered by tests
  including exact-half cases.
- Conversion MUST be applied per line item, with an expense's home-currency total derived as the sum
  of its non-personal converted line items.
- `shared/src/calc/settlement.ts` MUST NOT change. Its existing unit and property tests MUST pass
  untouched, and CI MUST fail if the file's content changes in this feature's branch.
- A rate, once applied to an expense, MUST NOT change except by explicit correction, and MUST NOT
  change at all once the expense is in any settlement.
- Rates MUST be fetched server-side and cached in the database, so that repeated expense creation
  on the same day does not repeatedly call the rate source.
- Rate-source failure MUST degrade — never block draft creation.
- Any new route MUST have an entry in `AUTHORIZATION.md` and a negative cross-household test, per
  project convention.
- The migration MUST leave every existing expense's stored amounts byte-identical, and MUST be
  additive in the sense that no existing value is overwritten.

## Success Criteria

- **SC-001**: A euro receipt scanned abroad produces an expense showing the euro total from the
  receipt, the home-currency total, and the rate used. Verified end to end on a device.
- **SC-002**: For every expense, the home-currency total equals the sum of its non-personal line
  items' home-currency amounts, exactly, with no rounding residual. Verified by a property-based
  test over randomised line items and rates, including the derived-rate correction path.
- **SC-003**: Settlement and statistics output is bit-identical before and after this feature for a
  dataset containing only home-currency expenses. Verified by snapshot comparison on seed data.
- **SC-004**: The existing settlement test suites pass with `shared/src/calc/settlement.ts`
  unmodified. Verified in CI.
- **SC-005**: Correcting a rate on an unsettled expense updates its home-currency total and the
  provisional balance; attempting the same on a settled expense, or one in an open settlement, is
  rejected. Verified by integration test.
- **SC-006**: With the rate source unreachable, a foreign-currency draft can still be created and
  is marked as using a cached or manual rate, or pending. Verified by integration test with the
  source stubbed to fail.
- **SC-007**: The trip dashboard's provisional balance matches the settlement subsequently produced
  from the same confirmed expenses. Verified by integration test.
- **SC-008**: No floating-point value is persisted for any monetary amount or rate. Verified by
  schema review and test.

## Assumptions

- The household's home currency is NOK and is fixed. It is stored but not user-configurable.
- Norges Bank daily reference rates are an acceptable basis. Daily granularity is appropriate
  because card statements settle on a daily rate; intraday precision would be false precision.
- Members will correct rates only occasionally, when a charge is materially different — the
  correction path is a convenience, not a routine step.
- Receipts abroad are predominantly in one currency per trip, so a project-level default currency
  removes most of the picking.
- Spec 004 has shipped, so foreign receipts are captured on a phone at the point of purchase and
  drafts are created server-side.
