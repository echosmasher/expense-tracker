# Implementation Plan: Decouple Settlement from Calendar Month

**Branch**: `003-decouple-settlement` | **Date**: 2026-05-25 | **Spec**: [spec.md](./spec.md)

## Summary

Replace the "settlement = previous month" coupling with a snapshot model. On trigger, the backend captures the IDs of all `confirmed` household expenses into a new `settlement_expenses` join table. On close, only those snapshotted expenses are marked `settled`. The `settlements` table keeps `created_at` as the single time anchor; `period_month`/`period_year` are preserved on historical rows but never written on new settlements. Frontend stops rendering month labels for settlements and renders trigger date + covered date range instead. Statistics is untouched — it already groups by `expense_date`.

## Constitution Check

| Principle | Status | Notes |
|---|---|---|
| API-First, Stateless Backend | PASS | All snapshot/close logic lives in the backend; frontend consumes typed responses |
| Financial Accuracy | PASS | Settlement calculation in `shared/src/calc/settlement.ts` unchanged — pure integer arithmetic preserved |
| Self-Hosted, Docker-Native | PASS | No new services; one additive migration |
| Migrations Are Additive | PASS | New table + nullable columns; no destructive drops on existing historical data |

---

## Data Model Changes

### New table: `settlement_expenses`

The snapshot of which expenses belong to a settlement.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK, default gen_random_uuid() |
| `settlement_id` | UUID | FK → settlements.id ON DELETE CASCADE, NOT NULL |
| `expense_id` | UUID | FK → expenses.id, NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |

`UNIQUE(settlement_id, expense_id)` — an expense can appear at most once in a given settlement.
Index on `settlement_id`.
Index on `expense_id` (to query "which settlement settled this expense?").

### Changes to `settlements`

- `period_month` and `period_year` are kept (still NULLABLE) for backwards compatibility with historical rows.
- New settlements MUST insert `NULL` for both columns.
- No `CHECK` constraint changes — both were already nullable for project settlements.

### Changes to `expenses`

No schema changes. The `settled` status meaning is unchanged ("included in a completed settlement"), but the transition is now driven by snapshot membership instead of date.

---

## Migration: `008_settlement_expenses_snapshot.sql`

```sql
-- Create snapshot join table
CREATE TABLE settlement_expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  expense_id    UUID NOT NULL REFERENCES expenses(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (settlement_id, expense_id)
);

CREATE INDEX idx_settlement_expenses_settlement ON settlement_expenses (settlement_id);
CREATE INDEX idx_settlement_expenses_expense ON settlement_expenses (expense_id);

-- Backfill: for each historical settlement, derive its snapshot from the month
-- filter that was originally applied. This keeps the history view honest for
-- existing data. New settlements will populate this table directly.
INSERT INTO settlement_expenses (settlement_id, expense_id)
SELECT s.id, e.id
FROM settlements s
JOIN expenses e ON e.household_id = s.household_id
WHERE s.period_year IS NOT NULL
  AND s.period_month IS NOT NULL
  AND EXTRACT(YEAR FROM e.expense_date)  = s.period_year
  AND EXTRACT(MONTH FROM e.expense_date) = s.period_month
  AND e.status = 'settled';
```

Migration is additive — no column drops. The `period_month`/`period_year` columns stay so the History detail view can still render the original month label on legacy rows.

---

## Backend Changes

### `backend/src/api/routes/settlements.ts`

**POST `/households/:householdId/settlements`** — rewrite:

- Remove the `prevMonth`/`periodYear`/`periodMonth` computation (lines 116-119).
- Replace the "open existing for this period" check with a "any open settlement for this household" check.
- Replace the month-filtered expense query with:
  ```sql
  SELECT id, total_amount_ore, purchased_by
  FROM expenses
  WHERE household_id = $1 AND status = 'confirmed' AND project_id IS NULL
  ```
- Inside the existing `db.transaction`, after inserting the settlement row, insert one `settlement_expenses` row per included expense.
- Insert `NULL` for `period_year` / `period_month` on the new settlement row.
- Update the email `periodLabel` to use the trigger date (e.g. `"settlement triggered on 25. mai 2026"`) instead of the previous-month name.
- Update the response shape: `periodMonth` and `periodYear` removed; add `triggeredAt` (the `created_at` value) and `includedExpenseIds: string[]`.

**PATCH `/settlements/:settlementId/transactions/:transactionId`** — rewrite close logic:

- When `unpaidCount === 0`, replace the month-filtered `UPDATE expenses` (lines 354-366) with:
  ```sql
  UPDATE expenses
  SET status = 'settled'
  WHERE id IN (
    SELECT expense_id FROM settlement_expenses WHERE settlement_id = $1
  )
  AND status = 'confirmed'
  ```
  This marks every expense on the snapshot as settled, regardless of date. The `AND status = 'confirmed'` guard ensures we don't accidentally rewrite a `settled` expense (defensive — shouldn't happen, but cheap).

**GET `/households/:householdId/settlements`** — rewrite list query:

- Drop `period_year`, `period_month` from the SELECT.
- Add a join to compute covered range:
  ```sql
  SELECT s.id, s.status, s.created_at,
         MIN(e.expense_date) AS covered_from,
         MAX(e.expense_date) AS covered_to,
         COALESCE(SUM(li.total_price_ore) FILTER (WHERE li.is_personal = false), 0) AS total_amount_ore
  FROM settlements s
  LEFT JOIN settlement_expenses se ON se.settlement_id = s.id
  LEFT JOIN expenses e ON e.id = se.expense_id
  LEFT JOIN line_items li ON li.expense_id = e.id
  WHERE s.household_id = $1 AND s.project_id IS NULL
  GROUP BY s.id
  ORDER BY s.created_at DESC
  ```
- Response item shape: `{ id, status, triggeredAt, coveredFrom, coveredTo, totalAmountOre }`.
- For legacy rows where `settlement_expenses` is empty after backfill (e.g. settlements with no expenses), `coveredFrom`/`coveredTo` may be `null` — handle that on the frontend.

**GET `/households/:householdId/settlements/:settlementId`** — extend `buildSettlementResponse`:

- Add an `includedExpenses` array with each expense's `id`, `expense_date`, `total_amount_ore`, `store_name`.
- Keep returning legacy `periodMonth`/`periodYear` for historical rows so the detail view can still label them.
- Add `triggeredAt` (alias for `created_at`).

### `shared/src/api-client/index.ts`

- Update `Settlement` type: drop `periodMonth`/`periodYear` from the create response, add `triggeredAt: string`, `includedExpenseIds: string[]`.
- Add a new `SettlementHistoryRow` type with the list-endpoint fields.
- Add `IncludedExpense` for the detail view.
- The historical fields (`periodMonth`/`periodYear`) remain on the detail-view type as `number | null`.

---

## Frontend Changes

### `web/src/stores/settlementStore.ts`

- Update state shape to drop month fields from new-settlement reads.
- Use the new `SettlementHistoryRow` type for the list.

### `web/src/pages/Settlement/CurrentMonth.tsx`

- Rename file to `Active.tsx` (and the component to `ActiveSettlement`) to reflect that it is no longer month-scoped. Update the route in `App.tsx`.
- Replace `monthLabel(periodYear, periodMonth)` with `"Triggered " + formatDate(triggeredAt)` and a sub-label `"Covers " + coveredFrom + " – " + coveredTo`.
- Update error copy: `"No unsettled confirmed expenses for this period"` → `"No unsettled confirmed expenses to settle"`.

### `web/src/pages/Settlement/History.tsx`

- Drop `monthLabel(summary.periodYear, summary.periodMonth)`.
- Render: trigger date + covered date range + total + status badge.
- Detail view shows the new `includedExpenses` list grouped by expense_date month (for readability — purely a UI grouping, not a model concept).
- For legacy rows where `coveredFrom`/`coveredTo` are null, fall back to displaying the legacy `periodMonth`/`periodYear` if present.

### `web/src/components/AppShell.tsx`

- Update the navigation label from "Settlement" / "Current Month" to "Settlement" / "Active" (or similar) so it does not imply month-bound.

### Statistics

- No changes. `MonthlyOverview` and `CategoryTrends` already query by `expense_date`. Verify there is no "closed/open" badge in the UI; if one is rendered, remove it.

---

## Mobile (Expo)

The Expo app mirrors the web flow. The same renames and label changes apply. Out of scope for V1 of *this* spec if the mobile app already lags behind web — track as a follow-up if so.

---

## Test Plan

- **Backend unit tests** (`backend/src/api/routes/__tests__/settlements.test.ts`):
  - `POST` includes confirmed expenses from arbitrary months (seed data: expenses dated 90, 60, 10 days ago; all 3 appear on the balance sheet).
  - `POST` rejects with `NO_EXPENSES` when there are zero confirmed unsettled expenses.
  - `POST` rejects with `OPEN_SETTLEMENT_EXISTS` when an open settlement exists.
  - `POST` writes one `settlement_expenses` row per included expense.
  - Close handler marks every snapshotted expense as `settled`, leaving non-snapshotted confirmed expenses untouched.
  - Close handler does NOT re-touch already-`settled` expenses (defensive).
- **Migration test** (`backend/src/db/__tests__/migration_008.test.ts`):
  - Seed: one legacy completed settlement with `period_year=2026, period_month=4`, plus April-dated settled expenses + March/May confirmed expenses.
  - Run migration.
  - Assert `settlement_expenses` contains the April-dated rows only for that legacy settlement.
- **Frontend snapshot/visual** (manual for now): verify History and Active settlement pages render correct labels with no month references.
- **Statistics regression**: snapshot the statistics endpoint output for a seeded month before and after migration — they must be byte-equal.

## Rollout

Single-tenant self-hosted; one migration step, one deploy. No feature flag needed.
