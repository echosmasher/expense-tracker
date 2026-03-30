-- 002_create_indexes.sql

CREATE INDEX ON expenses (household_id, status);
CREATE INDEX ON expenses (project_id, status);
CREATE INDEX ON expenses (household_id, purchase_date);
CREATE INDEX ON line_items (expense_id);
CREATE INDEX ON settlement_transactions (settlement_id, paid_at);
CREATE INDEX ON household_members (household_id);
CREATE INDEX ON household_members (user_id);
CREATE INDEX ON invites (token_hash);
CREATE INDEX ON refresh_tokens (token_hash);
CREATE INDEX ON refresh_tokens (user_id);
CREATE INDEX ON cards (user_id);
CREATE INDEX ON allocation_key_shares (allocation_key_id);
CREATE INDEX ON personal_keywords (household_id);
CREATE INDEX ON settlement_balances (settlement_id);
