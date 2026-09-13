-- 009_expense_capture_id.sql
-- Spec 004 ticket 8: draft creation from an uploaded receipt must be
-- idempotent per capture — a retried upload never creates a second expense.
-- The client generates a UUID per capture; the server keys on it.
--
-- Additive: one nullable column, two partial unique indexes (one per scope,
-- since an expense belongs to exactly one of household_id/project_id).
-- No backfill — existing expenses have no capture.

ALTER TABLE expenses ADD COLUMN capture_id UUID;

CREATE UNIQUE INDEX idx_expenses_household_capture
  ON expenses (household_id, capture_id)
  WHERE household_id IS NOT NULL AND capture_id IS NOT NULL;

CREATE UNIQUE INDEX idx_expenses_project_capture
  ON expenses (project_id, capture_id)
  WHERE project_id IS NOT NULL AND capture_id IS NOT NULL;
