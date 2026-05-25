# Tasks: Decouple Settlement from Calendar Month

**Branch**: `003-decouple-settlement` | **Date**: 2026-05-25 | **Plan**: [plan.md](./plan.md)

---

## Task 1: Database migration — `settlement_expenses` snapshot table

**Description**: Create migration `008_settlement_expenses_snapshot.sql` adding the `settlement_expenses` join table and backfilling rows for existing completed settlements based on their stored `period_year` / `period_month`. Migration must be additive; do not drop `settlements.period_year` or `settlements.period_month`.

**Acceptance Criteria**:
- [ ] `settlement_expenses` table exists with columns: `id`, `settlement_id` (FK ON DELETE CASCADE), `expense_id` (FK), `created_at`
- [ ] `UNIQUE(settlement_id, expense_id)` constraint enforced
- [ ] Indexes on `settlement_id` and `expense_id` created
- [ ] Backfill query inserts one row per `(settlement_id, expense_id)` for legacy settlements where the expense's `(year, month)` matches the settlement's `period_year` / `period_month` AND the expense is `settled`
- [ ] `period_year` and `period_month` columns on `settlements` remain present and unchanged
- [ ] Migration runs cleanly on a fresh database and on a database with legacy completed settlements
- [ ] `cd backend && npm run migrate` succeeds

**Dependencies**: None
**Complexity**: Small

---

## Task 2: Backend — rewrite POST settlement to snapshot all confirmed expenses

**Description**: Modify `backend/src/api/routes/settlements.ts` `POST /` handler. Remove the previous-month calculation and the month-filtered expense query. Pull all `confirmed` household expenses (regardless of date) and write a `settlement_expenses` row per included expense inside the existing transaction. Insert `NULL` for `period_year` / `period_month`. Update the "open settlement exists" guard to be household-scoped, not period-scoped.

**Acceptance Criteria**:
- [ ] No reference to `prevMonth`, `periodYear`, `periodMonth` in the POST handler body
- [ ] Expense query filters `household_id = $1 AND status = 'confirmed' AND project_id IS NULL`
- [ ] Open-settlement guard returns `OPEN_SETTLEMENT_EXISTS` if any open settlement exists for the household
- [ ] `NO_EXPENSES` (409) returned when zero confirmed expenses found
- [ ] One `settlement_expenses` row inserted per included expense inside the same `db.transaction`
- [ ] Settlement row inserts `NULL` for `period_year` and `period_month`
- [ ] Email `periodLabel` uses trigger date format (e.g. `"25. mai 2026"`), not a month name
- [ ] Response shape includes `triggeredAt` and `includedExpenseIds: string[]`; no `periodMonth`/`periodYear`

**Dependencies**: Task 1
**Complexity**: Medium

---

## Task 3: Backend — rewrite close handler to settle snapshotted expenses only

**Description**: Modify the `PATCH /settlements/:settlementId/transactions/:transactionId` handler in `backend/src/api/routes/settlements.ts`. When `unpaidCount === 0`, replace the month-filtered `UPDATE expenses` with an update that targets only expenses listed in `settlement_expenses` for this settlement and currently `confirmed`.

**Acceptance Criteria**:
- [ ] The `UPDATE expenses SET status = 'settled'` query joins/subqueries `settlement_expenses WHERE settlement_id = $1`
- [ ] Query carries an `AND status = 'confirmed'` guard
- [ ] No reference to `EXTRACT(YEAR FROM expense_date)` or `EXTRACT(MONTH FROM expense_date)` in the close handler
- [ ] Settlement row's `status` is updated to `'completed'` in the same transaction
- [ ] Project settlement path (settlement.project_id is not null) is unchanged

**Dependencies**: Task 1, Task 2
**Complexity**: Small

---

## Task 4: Backend — extend list and detail endpoints with covered range + included expenses

**Description**: Modify the `GET /` (list) and `GET /:settlementId` (detail) handlers and `buildSettlementResponse`. List endpoint returns `coveredFrom`/`coveredTo` derived from joined expenses. Detail endpoint adds `includedExpenses` and `triggeredAt`. Legacy `periodMonth`/`periodYear` continue to be returned on detail responses for backwards-compat with historical rows.

**Acceptance Criteria**:
- [ ] `GET /` response items have shape: `{ id, status, triggeredAt, coveredFrom, coveredTo, totalAmountOre }`
- [ ] `coveredFrom` and `coveredTo` are computed via `MIN`/`MAX` over joined `expenses.expense_date` of snapshot rows; `null` when snapshot is empty
- [ ] `GET /:settlementId` response retains existing fields and adds `includedExpenses: Array<{ id, expenseDate, totalAmountOre, storeName }>`, `triggeredAt`
- [ ] Detail response still returns `periodMonth` and `periodYear` (may be `null` for new settlements)
- [ ] Sort order on list endpoint is by `created_at DESC` (replaces the old `period_year DESC, period_month DESC` sort)

**Dependencies**: Task 1

**Complexity**: Medium

---

## Task 5: Shared API client — update types

**Description**: Update types in `shared/src/api-client/index.ts` to reflect the new response shapes. Existing consumers (web, mobile) compile against this package.

**Acceptance Criteria**:
- [ ] New `SettlementHistoryRow` type matches the list-endpoint response
- [ ] `Settlement` (detail) type adds `triggeredAt: string`, `includedExpenses: IncludedExpense[]`; keeps `periodMonth: number | null`, `periodYear: number | null`
- [ ] Create-settlement response type includes `triggeredAt` and `includedExpenseIds: string[]`; `periodMonth`/`periodYear` removed
- [ ] `shared` package builds with `npm run build`

**Dependencies**: Task 2, Task 4
**Complexity**: Small

---

## Task 6: Frontend — rename CurrentMonth → Active and remove month label

**Description**: Rename `web/src/pages/Settlement/CurrentMonth.tsx` to `Active.tsx`; rename the exported component to `ActiveSettlement`. Update the route in `web/src/App.tsx`. Replace the `monthLabel(periodYear, periodMonth)` rendering with a trigger-date label plus a covered-range sub-label. Update error copy as specified in plan.md.

**Acceptance Criteria**:
- [ ] File renamed; component renamed; default export renamed
- [ ] Route in `App.tsx` updated
- [ ] No reference to `monthLabel`, `periodYear`, or `periodMonth` in the renamed file
- [ ] Trigger date rendered using existing date formatting (Norwegian locale, consistent with rest of app)
- [ ] Covered range rendered when present; hidden when expenses list is empty
- [ ] Error message for `NO_EXPENSES` reads "No unsettled confirmed expenses to settle"

**Dependencies**: Task 5
**Complexity**: Small

---

## Task 7: Frontend — settlement history without month labels

**Description**: Update `web/src/pages/Settlement/History.tsx` to render trigger date + covered date range + status + total instead of month label. Detail view shows `includedExpenses` grouped visually by month-of-`expense_date` (purely cosmetic grouping). For legacy rows where `coveredFrom`/`coveredTo` are null but `periodMonth`/`periodYear` are present, fall back to the month label.

**Acceptance Criteria**:
- [ ] History list rows render: trigger date, covered range, total amount, status pill
- [ ] No top-level `monthLabel(periodYear, periodMonth)` call on new rows
- [ ] Detail view renders `includedExpenses` grouped by month of `expense_date`
- [ ] Legacy row fallback: displays `monthLabel` when `coveredFrom` is null but `periodYear`/`periodMonth` are present
- [ ] Visual regression: list page renders correctly with both legacy and new settlements

**Dependencies**: Task 5
**Complexity**: Medium

---

## Task 8: Frontend — AppShell nav label + statistics audit

**Description**: Update `web/src/components/AppShell.tsx` to remove any "Current Month" wording in settlement nav. Audit Statistics pages (`MonthlyOverview`, `CategoryTrends`) and ExpenseList for any "closed/open month" badges; remove them.

**Acceptance Criteria**:
- [ ] AppShell navigation entry for settlement does not say "Current Month"
- [ ] Statistics pages confirmed to use `expense_date` for monthly buckets (no code change needed if already true; document the check)
- [ ] No "closed" / "open" badge rendered on any month UI element

**Dependencies**: Task 6
**Complexity**: Small

---

## Task 9: Backend tests — settlement snapshot behavior

**Description**: Add tests covering the new POST and PATCH behavior. Use a fresh test database seeded with a household, members, and expenses spanning at least three months.

**Acceptance Criteria**:
- [ ] Test: POST creates a settlement that includes ALL confirmed unsettled expenses regardless of date; one `settlement_expenses` row per expense
- [ ] Test: POST returns 409 `NO_EXPENSES` when zero confirmed expenses exist
- [ ] Test: POST returns 409 `OPEN_SETTLEMENT_EXISTS` when an open settlement exists for the household
- [ ] Test: closing a settlement marks EVERY expense in the snapshot as `settled` (assert spanning multiple months)
- [ ] Test: closing a settlement does NOT mark any non-snapshotted `confirmed` expense as settled (add a confirmed expense after settlement creation; verify it remains `confirmed`)
- [ ] All tests pass: `cd backend && npm test`

**Dependencies**: Tasks 2 and 3
**Complexity**: Medium

---

## Task 10: Migration test — backfill correctness

**Description**: Add a migration-level test that seeds a database to match the pre-migration shape (legacy settlement with `period_year` / `period_month`, plus expenses in and around that month), runs migration 008, and asserts the backfill populated `settlement_expenses` correctly.

**Acceptance Criteria**:
- [ ] Seed: one completed settlement for April 2026; expenses dated 2026-03-30 (confirmed), 2026-04-05 (settled), 2026-04-22 (settled), 2026-05-02 (confirmed)
- [ ] After migration: `settlement_expenses` contains exactly the two April-dated settled expenses linked to that settlement
- [ ] Confirmed expenses outside April are NOT in `settlement_expenses`
- [ ] Test passes: `cd backend && npm test -- migration_008`

**Dependencies**: Task 1
**Complexity**: Small

---

## Task 11: Statistics regression check

**Description**: Verify that monthly statistics output is byte-equal before and after the migration on identical seeded data. This is a confidence check, not new functionality.

**Acceptance Criteria**:
- [ ] Capture `GET /households/:id/statistics?month=YYYY-MM` JSON for a seeded month on a pre-migration database
- [ ] Run migration 008
- [ ] Capture same endpoint output post-migration
- [ ] Diff is empty
- [ ] Document the check in `specs/003-decouple-settlement/test-results.md` (or attach output to the PR)

**Dependencies**: Task 1
**Complexity**: Small

---

## Task 12: Update CLAUDE.md and SDD artifacts cross-references

**Description**: Update `projects/expense-tracker/CLAUDE.md` to note the new snapshot model in the settlement bullet, and bump the tasks.md status indicator in spec 001 if appropriate.

**Acceptance Criteria**:
- [ ] CLAUDE.md settlement bullet mentions snapshot model (one-liner)
- [ ] `specs/001-expense-tracker-app/spec.md` cross-references spec 003 where the monthly settlement behavior is described (FR-016 area)
- [ ] No other documentation drift

**Dependencies**: Tasks 1–8
**Complexity**: Small

---

## Sequencing Summary

```
Task 1 (migration)
   ├── Task 2 (POST)
   │      └── Task 3 (close handler)
   │             └── Task 9 (backend tests)
   ├── Task 4 (list + detail endpoints)
   ├── Task 10 (migration test)
   └── Task 11 (statistics regression check)

Task 2 + Task 4
   └── Task 5 (shared client types)
          ├── Task 6 (frontend Active page)
          │      └── Task 8 (AppShell + stats audit)
          └── Task 7 (frontend History page)

Tasks 1–8
   └── Task 12 (docs)
```
