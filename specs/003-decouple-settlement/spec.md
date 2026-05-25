# Feature Specification: Decouple Settlement from Calendar Month

**Feature Branch**: `003-decouple-settlement`
**Created**: 2026-05-25
**Status**: Draft
**Depends on**: 001-expense-tracker-app (settlements, expenses, statistics)

---

## Summary

Settlements are currently bound to a single calendar month: the admin can only settle the *previous* month, only expenses whose `expense_date` falls in that month are included, and only that month's expenses are marked `settled` on close. The household admin wants to run settlements on their own cadence (e.g. every three weeks, every two months) and to clear out every unsettled receipt — across however many months — in a single settlement.

This spec removes the month coupling from settlements. A settlement becomes a snapshot of "all confirmed-but-unsettled household expenses at trigger time", identified only by its `created_at` timestamp. Statistics continue to bucket expenses by `expense_date` month, so monthly spend breakdowns are unaffected.

## Business Value

The current behavior produced an incorrect outcome in testing: a settlement that included receipts from March, April, and May only marked April as closed because the close-handler filtered by the settlement's stored `period_month`. Receipts from March and May remained in `confirmed` status and would be double-counted in the next settlement. Decoupling settlement from month fixes this correctness bug *and* gives the admin flexibility over settlement cadence.

---

## User Stories

### User Story 1 -- Trigger Settlement Without a Period (Priority: P1)

The household admin triggers a settlement at any time. The settlement includes every household expense currently in `confirmed` status, regardless of when it was purchased. The admin does not pick a period and the system does not assume "previous month".

**Acceptance Scenarios**:

1. **Given** a household with confirmed expenses dated 2026-03-12, 2026-04-08, and 2026-05-22, **When** the admin triggers settlement on 2026-05-25, **Then** the new settlement includes all three expenses on its balance sheet.
2. **Given** a household with zero confirmed unsettled expenses, **When** the admin triggers settlement, **Then** the request is rejected with `NO_EXPENSES` and no settlement record is created.
3. **Given** an already-open (in-progress) settlement, **When** the admin triggers another settlement, **Then** the request is rejected with `OPEN_SETTLEMENT_EXISTS` (only one open settlement at a time per household).
4. **Given** a settlement is created, **Then** the response contains the list of included expense IDs and the calculated balances/transactions — no `periodMonth` or `periodYear` field is returned.
5. **Given** a settlement is created, **Then** an email notification is sent to every household member; the email subject/body refers to "settlement triggered on \<date\>" rather than a month name.
6. **Given** a non-admin member attempts to trigger settlement, **Then** the request is rejected with `ADMIN_ONLY`.

---

### User Story 2 -- Close Settlement Marks Only Snapshotted Expenses (Priority: P1)

When all transactions in a settlement are marked paid, the settlement closes and exactly the expenses snapshotted at trigger time are marked `settled`. Expenses added or confirmed after the settlement was triggered remain `confirmed` and are eligible for the next settlement.

**Acceptance Scenarios**:

1. **Given** a settlement triggered with three included expenses (A, B, C), **When** all of its transactions are marked paid, **Then** A, B, and C transition from `confirmed` to `settled` and the settlement status becomes `completed`.
2. **Given** the settlement above is still `open` and a new confirmed expense D is added afterwards, **When** the settlement closes, **Then** D remains in `confirmed` status (not swept into this settlement).
3. **Given** D from the scenario above, **When** the admin triggers the next settlement, **Then** D appears on its balance sheet.
4. **Given** a settlement whose included expenses span March, April, and May, **When** it closes, **Then** all March, April, and May expenses on its snapshot are marked `settled` — no expenses are skipped because of date.
5. **Given** a settlement transaction is marked paid by a non-party non-admin, **Then** the request is rejected with `FORBIDDEN`.

---

### User Story 3 -- Settlement History Without Months (Priority: P2)

The settlement history view lists past settlements by the date they were triggered and the date range of expenses they covered, not by month label.

**Acceptance Scenarios**:

1. **Given** a member opens settlement history, **Then** each row shows: trigger date, status (open/completed), covered date range (min and max `expense_date` of included expenses), and total amount settled.
2. **Given** a member taps a history row, **Then** they see the full balance sheet, transactions, and the list of included expenses with their original dates.
3. **Given** a historical settlement that was created under the old month-based model (pre-migration), **Then** it still displays in history with its original data preserved.
4. **Given** the settlement detail view, **Then** there is no "month" or "period" label — only "Triggered \<date\>" and "Covers \<date\> – \<date\>".

---

### User Story 4 -- Statistics Remain Monthly (Priority: P1)

Statistics continue to group spending by the calendar month of each expense's `expense_date`. Settlements do not change what month an expense belongs to in the statistics view.

**Acceptance Scenarios**:

1. **Given** a settled expense dated 2026-03-12 included in a settlement triggered on 2026-05-25, **When** a member opens the March statistics view, **Then** the expense appears in March's totals (not May).
2. **Given** the Statistics view, **Then** the monthly bar chart, donut chart, and category trend chart use `expense_date` for month bucketing — they are unaffected by which settlement an expense belongs to.
3. **Given** the Statistics view, **Then** there is no "closed/open" badge per month — months are not labeled as closed or open in the UI.
4. **Given** a member filters statistics by month, **Then** the filter uses `expense_date`, and both `confirmed` and `settled` expenses are included in the totals.

---

## Edge Cases

- A settlement is triggered with confirmed expenses that span more than 12 months. All are included on the same balance sheet; no monthly grouping is applied to the settlement itself.
- An expense in `pending_review` is never included in a settlement — only `confirmed` expenses are eligible.
- An expense that was `confirmed` at the moment of settlement trigger but later edited (line items changed) before the settlement closes: the snapshot captures the expense ID, and balance calculations use the values *as of trigger time*. Mid-flight edits to a snapshotted expense do not retroactively change the balance sheet.
- A household with a single member cannot run a useful settlement (no one to settle with). The API still allows it: a zero-transaction settlement is created and immediately closeable, marking its expenses `settled`.
- A historical settlement created under the old month-based model still has its `period_month`/`period_year` displayed in the detail view if those fields are preserved by migration; new settlements never populate them.
- The "previous month" assumption is removed entirely. Triggering settlement on the 1st of a month does *not* implicitly mean "settle last month" — it means "settle everything confirmed right now".

---

## Out of Scope (V1)

- Admin-selectable cutoff date when triggering settlement (always includes all confirmed expenses; no `expense_date <= X` filter).
- Multiple concurrent open settlements per household.
- Re-opening a closed settlement.
- Partial settlements where the admin picks which confirmed expenses to include.
- Backfilling historical settlements into the new model (existing completed settlements are read-only and display as-is).
- Changes to project settlements — projects continue to settle independently as defined in spec 001.

---

## Non-Functional Requirements

- The settlement-create operation must remain a single database transaction, so a failure mid-snapshot does not leave a partial settlement.
- Listing settlement history must remain O(n) in the number of settlements, with included expense dates fetched in a single join — no N+1.
- Existing completed settlements created under the old model MUST remain readable; the migration must preserve their `period_month`/`period_year` values for display.
- The settlement balance calculation algorithm in `shared/src/calc/settlement.ts` is unchanged — only the set of expenses fed into it changes.

---

## Success Criteria

- **SC-001**: A settlement triggered on day X includes every household expense with `status='confirmed'` at that instant, regardless of `expense_date`. Verified by integration test with expenses spanning ≥3 months.
- **SC-002**: When a multi-month settlement closes, *every* expense on its snapshot transitions to `settled`. No `confirmed` expense from the snapshot is left behind. Verified by the regression scenario from User Story 2.
- **SC-003**: Monthly statistics totals for any past month are unchanged before and after this feature ships, given the same underlying expenses. Verified by snapshotting statistics output on a seed dataset.
- **SC-004**: The settlement history page renders without any month label and shows a date range derived from included expenses. Verified by UI inspection.
- **SC-005**: Old (pre-migration) completed settlements remain visible in history with their original balances and transactions intact. Verified by migration test on a copy of production-shape data.
