-- 008_settlement_expenses_snapshot.sql
-- Decouple settlements from calendar month (spec 003-decouple-settlement).
-- Adds a snapshot table that records which expenses each settlement covers.
-- New settlements populate this table directly; legacy completed settlements
-- are backfilled from their stored period_year/period_month.

CREATE TABLE settlement_expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  expense_id    UUID NOT NULL REFERENCES expenses(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (settlement_id, expense_id)
);

CREATE INDEX idx_settlement_expenses_settlement ON settlement_expenses (settlement_id);
CREATE INDEX idx_settlement_expenses_expense    ON settlement_expenses (expense_id);

-- Backfill: link each legacy completed settlement to the expenses that fell in
-- its period_year/period_month and ended up settled. After this runs, history
-- queries that derive a covered date range from settlement_expenses work for
-- old rows too.
INSERT INTO settlement_expenses (settlement_id, expense_id)
SELECT s.id, e.id
FROM settlements s
JOIN expenses   e ON e.household_id = s.household_id
WHERE s.period_year  IS NOT NULL
  AND s.period_month IS NOT NULL
  AND EXTRACT(YEAR  FROM e.expense_date) = s.period_year
  AND EXTRACT(MONTH FROM e.expense_date) = s.period_month
  AND e.status = 'settled';
