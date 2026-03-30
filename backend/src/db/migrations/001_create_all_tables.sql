-- 001_create_all_tables.sql
-- All monetary values: integers in øre (100 øre = 1 NOK)
-- All allocation shares: integers in basis points (10000 bp = 100%)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Refresh tokens (JWT rotation)
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payment cards (last 4 digits + label, for purchaser detection)
CREATE TABLE cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_four CHAR(4) NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Households
CREATE TABLE households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
  current_allocation_key_id UUID, -- FK added after allocation_keys table
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Household members
CREATE TABLE household_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, user_id)
);

-- Invite links
CREATE TABLE invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Allocation keys (immutable snapshots; new key inserted on change)
CREATE TABLE allocation_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add FK from households to allocation_keys (circular, nullable)
ALTER TABLE households
  ADD CONSTRAINT fk_current_allocation_key
  FOREIGN KEY (current_allocation_key_id)
  REFERENCES allocation_keys(id)
  ON DELETE SET NULL;

-- Allocation key shares (sum of share_bp per key must equal 10000)
CREATE TABLE allocation_key_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_key_id UUID NOT NULL REFERENCES allocation_keys(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_bp INT NOT NULL CHECK (share_bp > 0),
  UNIQUE (allocation_key_id, user_id)
);

-- Tags (per household; Household + Personal seeded on household creation)
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_personal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, name)
);

-- Personal keywords (auto-tag matching line items as Personal)
CREATE TABLE personal_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, keyword)
);

-- Projects (separate expense pools with own lifecycle)
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settling', 'settled')),
  allocation_key_id UUID NOT NULL REFERENCES allocation_keys(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Project members (subset of household members)
CREATE TABLE project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

-- Expenses (belongs to household OR project, never both)
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  purchased_by_user_id UUID NOT NULL REFERENCES users(id),
  purchase_date DATE NOT NULL,
  receipt_image_key TEXT,
  default_tag_id UUID NOT NULL REFERENCES tags(id),
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'confirmed', 'settled')),
  store_name TEXT,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT expense_belongs_to_one
    CHECK (
      (household_id IS NOT NULL AND project_id IS NULL) OR
      (household_id IS NULL AND project_id IS NOT NULL)
    )
);

-- Line items (individual products within an expense; amounts in øre)
CREATE TABLE line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity_bp INT NOT NULL DEFAULT 10000 CHECK (quantity_bp > 0), -- basis points: 10000 = 1 unit
  unit_price_ore INT NOT NULL,
  total_price_ore INT NOT NULL,
  tag_id UUID REFERENCES tags(id), -- overrides expense default_tag if set
  is_personal BOOLEAN NOT NULL DEFAULT false,
  confidence_low BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Settlements (for household monthly periods or project scope)
CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  period_month INT CHECK (period_month BETWEEN 1 AND 12),
  period_year INT,
  allocation_key_id UUID NOT NULL REFERENCES allocation_keys(id), -- snapshot at trigger time
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
  triggered_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT settlement_belongs_to_one
    CHECK (
      (household_id IS NOT NULL AND project_id IS NULL) OR
      (household_id IS NULL AND project_id IS NOT NULL)
    )
);

-- Per-member balances for a settlement (amounts in øre)
-- positive = member is owed money, negative = member owes money
CREATE TABLE settlement_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  amount_ore INT NOT NULL,
  UNIQUE (settlement_id, user_id)
);

-- Individual payment transactions within a settlement (amounts in øre)
CREATE TABLE settlement_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES users(id),
  to_user_id UUID NOT NULL REFERENCES users(id),
  amount_ore INT NOT NULL CHECK (amount_ore > 0),
  paid_at TIMESTAMPTZ, -- NULL = unpaid
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
