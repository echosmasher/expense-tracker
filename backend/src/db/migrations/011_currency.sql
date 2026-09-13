-- 011_currency.sql
-- Ticket 13 (spec 005): currency as a first-class property of an expense.
-- Additive: every new column is nullable or defaulted, no existing value is
-- overwritten. Existing rows read as home-currency (NOK) with no rate.

-- Household home currency. Fixed NOK for V1 (out of scope: per-household
-- configuration), but stored and exposed read-only per the plan.
ALTER TABLE households ADD COLUMN home_currency CHAR(3) NOT NULL DEFAULT 'NOK';

-- Pre-selects the currency picker for expenses created inside a project.
ALTER TABLE projects ADD COLUMN default_currency CHAR(3);

-- Expense-level currency and rate.
ALTER TABLE expenses ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'NOK';
ALTER TABLE expenses ADD COLUMN original_total_minor BIGINT;
ALTER TABLE expenses ADD COLUMN rate_scaled BIGINT;
ALTER TABLE expenses ADD COLUMN rate_date DATE;
ALTER TABLE expenses ADD COLUMN rate_source TEXT
  CHECK (rate_source IN ('norges_bank', 'cached', 'manual', 'corrected', 'derived', 'pending'));
ALTER TABLE expenses ADD COLUMN rate_captured_at TIMESTAMPTZ;

-- Home-currency rows must carry no rate metadata; foreign rows must carry a
-- rate_source, and a rate_scaled unless the rate is still pending (drafts
-- awaiting a resolvable or manual rate cannot be confirmed — enforced in the
-- confirm route, not here).
ALTER TABLE expenses ADD CONSTRAINT expenses_currency_rate_consistency CHECK (
  (currency = 'NOK' AND original_total_minor IS NULL AND rate_scaled IS NULL
    AND rate_date IS NULL AND rate_source IS NULL AND rate_captured_at IS NULL)
  OR
  (currency <> 'NOK' AND rate_source IS NOT NULL
    AND (rate_scaled IS NOT NULL OR rate_source = 'pending'))
);

-- Line-item original (foreign-currency) amounts, alongside the existing
-- home-currency unit_price_ore / total_price_ore columns.
ALTER TABLE line_items ADD COLUMN original_unit_price_minor BIGINT;
ALTER TABLE line_items ADD COLUMN original_total_minor BIGINT;

-- Exchange rate cache: every observation Norges Bank returns is stored, so
-- repeated expense creation on the same day never re-fetches.
CREATE TABLE exchange_rates (
  currency    CHAR(3) NOT NULL,
  rate_date   DATE NOT NULL,
  rate_scaled BIGINT NOT NULL,
  source      TEXT NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (currency, rate_date)
);
