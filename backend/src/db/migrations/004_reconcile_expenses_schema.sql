-- Reconciles the expenses and line_items tables with what the application code
-- actually reads and writes. Migration 001 drifted from the implementation
-- (columns renamed, missing, or declared NOT NULL without being populated).
-- This migration aligns the schema to the code so expense creation works.

-- ── expenses ─────────────────────────────────────────────────────────────────

ALTER TABLE expenses RENAME COLUMN purchased_by_user_id TO purchased_by;
ALTER TABLE expenses RENAME COLUMN purchase_date        TO expense_date;
ALTER TABLE expenses RENAME COLUMN store_name           TO store;

-- Receipt parsing may not produce a date; code inserts NULL in that case.
ALTER TABLE expenses ALTER COLUMN expense_date DROP NOT NULL;

-- Columns the code writes but the original schema omitted.
ALTER TABLE expenses ADD COLUMN total_amount_ore BIGINT;
ALTER TABLE expenses ADD COLUMN card_last_four   TEXT;
UPDATE expenses SET total_amount_ore = 0 WHERE total_amount_ore IS NULL;
ALTER TABLE expenses ALTER COLUMN total_amount_ore SET NOT NULL;

-- Columns the code never populates.
ALTER TABLE expenses ALTER COLUMN default_tag_id      DROP NOT NULL;
ALTER TABLE expenses ALTER COLUMN created_by_user_id  DROP NOT NULL;

-- ── line_items ───────────────────────────────────────────────────────────────

ALTER TABLE line_items RENAME COLUMN quantity_bp TO quantity;
ALTER TABLE line_items ALTER COLUMN quantity SET DEFAULT 1;
ALTER TABLE line_items ALTER COLUMN total_price_ore DROP NOT NULL;
