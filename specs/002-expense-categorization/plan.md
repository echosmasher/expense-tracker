# Implementation Plan: Expense Categorization

**Branch**: `002-expense-categorization` | **Date**: 2026-04-06 | **Spec**: [spec.md](./spec.md)

## Summary

Add product-level categorization to receipt line items using a two-tier strategy: (1) a per-household lookup table of saved mappings (item description -> category) checked first, and (2) an AI categorization call for unmapped items. Users can correct categories, which updates the mapping table for future use. Statistics gains a category breakdown view.

## Constitution Check

| Principle | Status | Notes |
|---|---|---|
| API-First, Stateless Backend | PASS | Categorization logic runs server-side; frontend displays results |
| Financial Accuracy | N/A | Categories do not affect monetary calculations |
| Self-Hosted, Docker-Native | PASS | No new external services; reuses existing OpenAI API |

---

## Data Model Changes

### New table: `categories`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK, default gen_random_uuid() |
| `household_id` | UUID | FK -> households.id, NOT NULL |
| `name` | TEXT | NOT NULL |
| `is_system` | BOOLEAN | NOT NULL, default false |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |

UNIQUE(household_id, lower(name))

Seed per household: one row with `name = 'Uncategorized'`, `is_system = true`.

### New table: `category_mappings`

Maps a normalized item description to a category within a household. This is the learning mechanism.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK, default gen_random_uuid() |
| `household_id` | UUID | FK -> households.id, NOT NULL |
| `normalized_description` | TEXT | NOT NULL |
| `category_id` | UUID | FK -> categories.id, NOT NULL |
| `source` | TEXT | NOT NULL, CHECK IN ('ai', 'user') |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now() |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() |

UNIQUE(household_id, normalized_description)

**Normalization rule**: `LOWER(TRIM(description))`. No further normalization in V1.

### Modified table: `line_items`

Add column:

| Column | Type | Constraints |
|---|---|---|
| `category_id` | UUID | FK -> categories.id, NULLABLE |

NULLABLE because historical line items won't have a category until backfill (out of scope for V1).

### Indexes

```sql
CREATE UNIQUE INDEX ON categories (household_id, lower(name));
CREATE UNIQUE INDEX ON category_mappings (household_id, normalized_description);
CREATE INDEX ON line_items (category_id);
```

---

## Categorization Flow

### Step-by-step (runs after receipt parsing, before review screen)

```
1. Receipt parsed -> list of line items with descriptions
2. For each item:
   a. Normalize description: lower(trim(description))
   b. Look up in category_mappings for this household
   c. If found -> assign that category_id (skip AI)
   d. If not found -> add to "needs AI" batch
3. Send "needs AI" batch to AI categorization endpoint (single call)
4. For each AI result:
   a. If confidence >= threshold -> assign category, save mapping (source: 'ai')
   b. If confidence < threshold -> assign "Uncategorized" category, do NOT save mapping
5. Return all items with their categories to the review screen
```

### User correction flow

```
1. User changes category on a line item (review screen or expense detail)
2. API call: PATCH /line_items/:id/category { categoryName: "Coffee" }
3. Backend:
   a. Find or create category by name in household
   b. Update line_item.category_id
   c. Upsert category_mapping for (household_id, normalized_description) with source: 'user'
4. Future items with same normalized description auto-resolve at step 2b
```

---

## AI Categorization Prompt

This is the system prompt for the categorization API call. It runs as a separate call from receipt parsing (not embedded in the receipt parse prompt) so that:
- Items with saved mappings skip AI entirely
- The prompt can be tuned independently of receipt parsing
- Categorization can be retried without re-parsing the receipt

### System Prompt

```
You are a grocery and household product categorizer. Given a list of product descriptions from a receipt (Norwegian, Swedish, or English), assign each item to exactly one product category.

Always respond with valid JSON only, no markdown, no explanation.

Input format:
{
  "items": [
    { "index": 0, "description": "KAFFE 450 G FILTERMALT" },
    { "index": 1, "description": "Zalo 500 ml" }
  ]
}

Response format:
{
  "results": [
    { "index": 0, "category": "Coffee", "confidence": "high" },
    { "index": 1, "category": "Cleaning Supplies", "confidence": "high" }
  ]
}

Rules:
- Use short, human-readable English category names (title case)
- Common categories include but are not limited to: Coffee, Tea, Dairy, Bread & Bakery, Meat, Fish & Seafood, Fruits & Vegetables, Frozen Food, Snacks & Candy, Beverages, Cleaning Supplies, Hygiene & Personal Care, Paper Products, Pet Supplies, Baby Products, Alcohol, Condiments & Spices, Pasta & Rice, Canned Goods, Breakfast Cereals
- You are NOT limited to the list above. If a product clearly belongs to a category not listed, use an appropriate name
- Prefer specific categories over generic ones: "Coffee" is better than "Beverages" for coffee products, "Cleaning Supplies" is better than "Household" for cleaning products
- If a product is ambiguous or you genuinely cannot determine what it is, set confidence to "low"
- Norwegian grocery terms to be aware of:
  - "kaffe" = coffee, "melk" = milk, "brød" = bread, "ost" = cheese
  - "tannkrem" / "tannbørste" = dental/hygiene, "såpe" = soap
  - "oppvaskmiddel" / "Zalo" = dish soap (cleaning supplies)
  - "kjøtt" = meat, "fisk" = fish, "grønnsaker" = vegetables
  - "vaskemiddel" = laundry detergent, "toalettpapir" = toilet paper
  - Brand names: "Zalo" = dish soap, "Jif" = cleaning, "Blenda" = laundry detergent
- Swedish grocery terms:
  - "kaffe" = coffee, "mjölk" = milk, "bröd" = bread
  - "tandkräm" = toothpaste, "tvål" = soap, "diskmedel" = dish soap
- Receipt descriptions are often truncated or abbreviated. Use your best judgment
- "BLUE JAVA" is a coffee brand -> category "Coffee"
- When in doubt between two plausible categories, pick the more specific one and set confidence to "medium"
```

### User Prompt (per batch)

```
Categorize these receipt items:
{
  "items": [
    { "index": 0, "description": "<item 1>" },
    { "index": 1, "description": "<item 2>" }
  ]
}
```

### Confidence Thresholds

| AI confidence | Action |
|---|---|
| `"high"` | Assign category, save mapping with source `'ai'` |
| `"medium"` | Assign category, save mapping with source `'ai'` |
| `"low"` | Assign "Uncategorized", do NOT save mapping, flag for user review |

---

## API Changes

### New endpoints

#### `PATCH /api/v1/households/:householdId/expenses/:expenseId/line-items/:lineItemId/category`

Update the category of a single line item. Creates the category if it doesn't exist. Upserts the mapping.

**Request**
```json
{ "categoryName": "Coffee" }
```

**Response 200**
```json
{
  "lineItemId": "uuid",
  "categoryId": "uuid",
  "categoryName": "Coffee",
  "mappingSaved": true
}
```

**Errors**: `400 VALIDATION_ERROR`, `403 FORBIDDEN`, `404 NOT_FOUND`

#### `GET /api/v1/households/:householdId/categories`

List all categories for the household, with mapping count.

**Response 200**
```json
{
  "categories": [
    { "id": "uuid", "name": "Coffee", "isSystem": false, "mappingCount": 12 },
    { "id": "uuid", "name": "Uncategorized", "isSystem": true, "mappingCount": 0 }
  ]
}
```

#### `PATCH /api/v1/households/:householdId/categories/:categoryId`

Rename a category. If the new name matches an existing category, merge into it.

**Request**
```json
{ "name": "Hot Beverages" }
```

**Response 200**
```json
{ "id": "uuid", "name": "Hot Beverages", "merged": false }
```

#### `DELETE /api/v1/households/:householdId/categories/:categoryId`

Delete a category. All line items and mappings revert to "Uncategorized". Cannot delete system categories.

**Response 204** (no body)

**Errors**: `400 CANNOT_DELETE_SYSTEM_CATEGORY`, `404 NOT_FOUND`

### Modified endpoints

#### `GET /api/v1/households/:householdId/statistics`

Add `byCategory` array to response:

```json
{
  "month": "2026-04",
  "totalOre": 125000,
  "byTag": [ ... ],
  "byMember": [ ... ],
  "byCategory": [
    { "categoryId": "uuid", "categoryName": "Coffee", "totalOre": 18900, "itemCount": 4 },
    { "categoryId": "uuid", "categoryName": "Cleaning Supplies", "totalOre": 8500, "itemCount": 2 },
    { "categoryId": null, "categoryName": "Uncategorized", "totalOre": 3200, "itemCount": 1 }
  ],
  "categoryTrends": [
    {
      "month": "2025-11",
      "byCategory": [
        { "categoryId": "uuid", "categoryName": "Coffee", "totalOre": 15600 }
      ]
    }
  ],
  "topItems": [ ... ],
  "trends": [ ... ]
}
```

#### CSV export

Add `Category` column after `Tag` column.

---

## New backend service: `categoryService.ts`

Location: `backend/src/services/categoryService.ts`

Responsibilities:
1. `categorizeLineItems(householdId, items[])` -- orchestrates the two-tier lookup + AI flow
2. `updateLineItemCategory(householdId, lineItemId, categoryName)` -- handles user corrections
3. `getOrCreateCategory(householdId, name)` -- find-or-create by normalized name
4. `lookupMappings(householdId, descriptions[])` -- batch lookup in category_mappings

The AI call uses the existing OpenAI client from `receiptParser.ts` with `gpt-4o-mini` and the categorization prompt above.

---

## Frontend Changes

### Review screen (AddExpense)

- Each line item row shows a category pill/badge next to the tag badge
- "Uncategorized" items have an amber/warning-colored badge
- Tapping/clicking the category badge opens a dropdown: existing categories + "New category..." option
- Changing a category triggers `PATCH .../line-items/:id/category`

### Statistics (MonthlyOverview)

- New "By Category" section with donut chart (Recharts `PieChart`)
- New "Category Trends" section with stacked bar chart (Recharts `BarChart`) for last 6 months
- Tooltip on hover/tap shows category name + amount in NOK

### Settings (household)

- New "Categories" tab showing all categories, mapping counts, rename/merge/delete actions
- Admin-only for rename/merge/delete

---

## Migration

```sql
-- 003_add_categories.sql

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON categories (household_id, lower(name));

CREATE TABLE category_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id),
  normalized_description TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id),
  source TEXT NOT NULL CHECK (source IN ('ai', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON category_mappings (household_id, normalized_description);

ALTER TABLE line_items ADD COLUMN category_id UUID REFERENCES categories(id);
CREATE INDEX ON line_items (category_id);

-- Seed "Uncategorized" for each existing household
INSERT INTO categories (household_id, name, is_system)
SELECT id, 'Uncategorized', true FROM households;
```
