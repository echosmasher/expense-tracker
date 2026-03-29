# Data Model: Expense Tracker App

**Branch**: `001-expense-tracker-app` | **Date**: 2026-03-29

All monetary values are integers in **øre** (100 øre = 1 NOK).
All allocation shares are integers in **basis points** (10 000 bp = 100%).

---

## Entity Relationship Overview

```
users ──────────────── household_members ──── households
  │                          │                     │
  │                          │              allocation_keys
  ├── cards                  │                     │
  │                          │              allocation_key_shares
  └── invites ───────────────┘                     │
                                                    │
households ─────── tags                            │
          └─────── personal_keywords               │
                                                    │
expenses ──── households (or projects)             │
  │      └─── allocation_key (at settlement time) ─┘
  └── line_items
        └── tag (nullable, overrides expense tag)

projects ─── households
         ├── project_members
         └── expenses

settlements ─── households (or projects)
            ├── settlement_balances
            └── settlement_transactions
```

---

## Tables

### `users`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK, default gen_random_uuid() |
| `email` | TEXT | NOT NULL, UNIQUE |
| `password_hash` | TEXT | NOT NULL |
| `name` | TEXT | NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() |

---

### `refresh_tokens`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → users.id, NOT NULL |
| `token_hash` | TEXT | NOT NULL, UNIQUE |
| `expires_at` | TIMESTAMPTZ | NOT NULL |
| `revoked_at` | TIMESTAMPTZ | NULLABLE |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |

---

### `cards`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → users.id, NOT NULL |
| `last_four` | CHAR(4) | NOT NULL |
| `label` | TEXT | NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |

---

### `households`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | NOT NULL |
| `address` | TEXT | NOT NULL |
| `status` | TEXT | NOT NULL, CHECK IN ('pending', 'active') |
| `current_allocation_key_id` | UUID | FK → allocation_keys.id, NULLABLE |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() |

---

### `household_members`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `household_id` | UUID | FK → households.id, NOT NULL |
| `user_id` | UUID | FK → users.id, NOT NULL |
| `role` | TEXT | NOT NULL, CHECK IN ('admin', 'member') |
| `joined_at` | TIMESTAMPTZ | NOT NULL, default now() |

UNIQUE(household_id, user_id)

---

### `invites`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `household_id` | UUID | FK → households.id, NOT NULL |
| `email` | TEXT | NOT NULL |
| `token_hash` | TEXT | NOT NULL, UNIQUE |
| `accepted_at` | TIMESTAMPTZ | NULLABLE |
| `expires_at` | TIMESTAMPTZ | NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |

---

### `allocation_keys`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `household_id` | UUID | FK → households.id, NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |

---

### `allocation_key_shares`

Stores each member's share of an allocation key in basis points. All shares for a given key MUST sum to 10 000.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `allocation_key_id` | UUID | FK → allocation_keys.id, NOT NULL |
| `user_id` | UUID | FK → users.id, NOT NULL |
| `share_bp` | INT | NOT NULL, CHECK > 0 |

UNIQUE(allocation_key_id, user_id)

---

### `tags`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `household_id` | UUID | FK → households.id, NOT NULL |
| `name` | TEXT | NOT NULL |
| `is_personal` | BOOLEAN | NOT NULL, default false |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |

UNIQUE(household_id, name)

Seed data per household: `Household` (is_personal=false), `Personal` (is_personal=true).

---

### `personal_keywords`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `household_id` | UUID | FK → households.id, NOT NULL |
| `keyword` | TEXT | NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |

UNIQUE(household_id, keyword)

---

### `expenses`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `household_id` | UUID | FK → households.id, NULLABLE (null if project expense) |
| `project_id` | UUID | FK → projects.id, NULLABLE (null if household expense) |
| `purchased_by_user_id` | UUID | FK → users.id, NOT NULL |
| `purchase_date` | DATE | NOT NULL |
| `receipt_image_key` | TEXT | NULLABLE (MinIO object key) |
| `default_tag_id` | UUID | FK → tags.id, NOT NULL |
| `status` | TEXT | NOT NULL, CHECK IN ('pending_review', 'confirmed', 'settled') |
| `store_name` | TEXT | NULLABLE |
| `created_by_user_id` | UUID | FK → users.id, NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() |

CHECK: exactly one of household_id or project_id is NOT NULL.

---

### `line_items`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `expense_id` | UUID | FK → expenses.id, NOT NULL |
| `description` | TEXT | NOT NULL |
| `quantity_bp` | INT | NOT NULL, default 10000 (= 1 unit in basis points) |
| `unit_price_ore` | INT | NOT NULL |
| `total_price_ore` | INT | NOT NULL |
| `tag_id` | UUID | FK → tags.id, NULLABLE (overrides expense default_tag if set) |
| `is_personal` | BOOLEAN | NOT NULL, default false |
| `confidence_low` | BOOLEAN | NOT NULL, default false (AI parse flag) |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |

---

### `projects`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `household_id` | UUID | FK → households.id, NOT NULL |
| `name` | TEXT | NOT NULL |
| `description` | TEXT | NULLABLE |
| `status` | TEXT | NOT NULL, CHECK IN ('active', 'settling', 'settled') |
| `allocation_key_id` | UUID | FK → allocation_keys.id, NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() |

---

### `project_members`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `project_id` | UUID | FK → projects.id, NOT NULL |
| `user_id` | UUID | FK → users.id, NOT NULL |
| `joined_at` | TIMESTAMPTZ | NOT NULL, default now() |

UNIQUE(project_id, user_id)

---

### `settlements`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `household_id` | UUID | FK → households.id, NULLABLE |
| `project_id` | UUID | FK → projects.id, NULLABLE |
| `period_month` | INT | NULLABLE, CHECK 1–12 (null for project settlements) |
| `period_year` | INT | NULLABLE (null for project settlements) |
| `allocation_key_id` | UUID | FK → allocation_keys.id, NOT NULL (snapshot of key at settlement time) |
| `status` | TEXT | NOT NULL, CHECK IN ('open', 'completed') |
| `triggered_by_user_id` | UUID | FK → users.id, NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() |

CHECK: exactly one of household_id or project_id is NOT NULL.

---

### `settlement_balances`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `settlement_id` | UUID | FK → settlements.id, NOT NULL |
| `user_id` | UUID | FK → users.id, NOT NULL |
| `amount_ore` | INT | NOT NULL (positive = is owed, negative = owes) |

UNIQUE(settlement_id, user_id)

---

### `settlement_transactions`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `settlement_id` | UUID | FK → settlements.id, NOT NULL |
| `from_user_id` | UUID | FK → users.id, NOT NULL |
| `to_user_id` | UUID | FK → users.id, NOT NULL |
| `amount_ore` | INT | NOT NULL, CHECK > 0 |
| `paid_at` | TIMESTAMPTZ | NULLABLE (null = unpaid) |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |

---

## Status Transitions

### Expense
```
pending_review → confirmed → settled
```
- `pending_review`: saved after upload, not yet confirmed by member
- `confirmed`: member has reviewed and confirmed; included in settlement calculations
- `settled`: included in a completed settlement

### Household
```
pending → active
```
- `pending`: fewer than 2 members joined
- `active`: 2+ members joined; expense tracking enabled

### Project
```
active → settling → settled
```
- `active`: accepting expenses
- `settling`: "Finish Project" triggered; settlement calculated, transactions open
- `settled`: all transactions marked paid

### Settlement
```
open → completed
```
- `open`: triggered; transactions available
- `completed`: all transactions marked paid

---

## Indexes (recommended)

```sql
CREATE INDEX ON expenses (household_id, status);
CREATE INDEX ON expenses (project_id, status);
CREATE INDEX ON line_items (expense_id);
CREATE INDEX ON settlement_transactions (settlement_id, paid_at);
CREATE INDEX ON household_members (household_id);
CREATE INDEX ON household_members (user_id);
CREATE INDEX ON invites (token_hash);
CREATE INDEX ON refresh_tokens (token_hash);
```
