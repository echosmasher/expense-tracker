-- 007_add_categories.sql
-- Product-level categorization for line items (spec 002-expense-categorization)

-- Categories (per household)
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_household_lower_name ON categories (household_id, lower(name));

-- Learned mappings: item description -> category (per household)
CREATE TABLE category_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  normalized_description TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('ai', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX category_mappings_household_desc ON category_mappings (household_id, normalized_description);

-- Add category_id to line_items (nullable for historical rows)
ALTER TABLE line_items ADD COLUMN category_id UUID REFERENCES categories(id) ON DELETE SET NULL;
CREATE INDEX line_items_category_id ON line_items (category_id);

-- Seed "Uncategorized" system category for every existing household
INSERT INTO categories (household_id, name, is_system)
SELECT id, 'Uncategorized', true FROM households;
