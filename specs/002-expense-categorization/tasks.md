# Tasks: Expense Categorization

**Branch**: `002-expense-categorization` | **Date**: 2026-04-06 | **Plan**: [plan.md](./plan.md)

---

## Task 1: Database migration -- categories, category_mappings, line_items.category_id

**Description**: Create migration `003_add_categories.sql` that adds the `categories` table, `category_mappings` table, adds `category_id` column to `line_items`, and seeds an "Uncategorized" system category for each existing household.

**Acceptance Criteria**:
- [ ] `categories` table exists with columns: id, household_id, name, is_system, created_at
- [ ] Unique index on `(household_id, lower(name))` prevents duplicate category names per household
- [ ] `category_mappings` table exists with columns: id, household_id, normalized_description, category_id, source, created_at, updated_at
- [ ] Unique index on `(household_id, normalized_description)` ensures one mapping per description per household
- [ ] `line_items.category_id` column added as nullable FK to `categories.id`
- [ ] Index on `line_items(category_id)` created
- [ ] Each existing household has an "Uncategorized" row in `categories` with `is_system = true`
- [ ] Migration runs cleanly on a fresh database and on an existing database with data
- [ ] `npm run migrate` succeeds

**Dependencies**: None
**Complexity**: Small

---

## Task 2: Category service -- getOrCreateCategory, lookupMappings, upsertMapping

**Description**: Create `backend/src/services/categoryService.ts` with the core category CRUD and mapping operations. This is the foundation that both the AI categorization flow and user correction flow depend on.

**Acceptance Criteria**:
- [ ] `getOrCreateCategory(householdId, name)` returns existing category (case-insensitive match) or creates a new one; returns `{ id, name, isSystem }`
- [ ] `lookupMappings(householdId, descriptions[])` takes an array of raw descriptions, normalizes them (`lower(trim())`), and returns a map of `normalizedDescription -> categoryId` for all found mappings
- [ ] `upsertMapping(householdId, description, categoryId, source)` inserts or updates a mapping row; on conflict updates `category_id`, `source`, and `updated_at`
- [ ] `ensureUncategorizedCategory(householdId)` returns the "Uncategorized" system category for a household, creating it if missing
- [ ] All functions use the existing `db.query<T>()` wrapper from `backend/src/db/client.ts`

**Dependencies**: Task 1
**Complexity**: Small

---

## Task 3: AI categorization prompt and caller

**Description**: Create the AI categorization function that sends a batch of item descriptions to the OpenAI API and returns categories with confidence levels. Uses the prompt from the plan. Runs as a separate API call from receipt parsing.

**Acceptance Criteria**:
- [ ] `categorizeWithAI(items: { index: number, description: string }[])` sends the batch to `gpt-4o-mini` with the categorization system prompt from the plan
- [ ] Returns `{ index, category, confidence }[]` where confidence is `"high"`, `"medium"`, or `"low"`
- [ ] Uses `response_format: { type: 'json_object' }` for structured output
- [ ] Timeout: 10 seconds (leaves headroom within the 15s receipt parse budget)
- [ ] On timeout or API error, returns all items with `category: "Uncategorized"` and `confidence: "low"` -- never throws
- [ ] Empty input array returns empty results without making an API call
- [ ] Uses the existing OpenAI client from `receiptParser.ts`

**Dependencies**: None
**Complexity**: Small

---

## Task 4: Categorization orchestrator -- categorizeLineItems

**Description**: Add `categorizeLineItems(householdId, items[])` to the category service. This is the main entry point that implements the two-tier lookup: check saved mappings first, then send unmapped items to AI, then save new mappings for confident results.

**Acceptance Criteria**:
- [ ] Takes `householdId` and an array of `{ description, ... }` line items
- [ ] Step 1: Calls `lookupMappings` for all descriptions; items with a saved mapping get their category assigned immediately
- [ ] Step 2: Items without a mapping are batched and sent to `categorizeWithAI`
- [ ] Step 3: AI results with confidence `"high"` or `"medium"` -- assigns category via `getOrCreateCategory`, saves mapping with `source: 'ai'`
- [ ] Step 4: AI results with confidence `"low"` -- assigns "Uncategorized" category, does NOT save a mapping
- [ ] Returns all items with their assigned `categoryId` and `categoryName`
- [ ] If all items have saved mappings, no AI call is made

**Dependencies**: Task 2, Task 3
**Complexity**: Medium

---

## Task 5: Integrate categorization into receipt upload flow

**Description**: Call `categorizeLineItems` after receipt parsing in the receipt upload endpoint, so that line items arrive at the review screen with categories already assigned. Also save `category_id` when the expense is confirmed.

**Acceptance Criteria**:
- [ ] After `parseReceipt()` returns items in the receipt upload route, `categorizeLineItems()` is called
- [ ] The response to the client includes `categoryId` and `categoryName` for each line item
- [ ] When the expense is saved (confirmed), `category_id` is written to `line_items` rows
- [ ] Manual entry flow also assigns "Uncategorized" to items (no AI call for manual entry unless descriptions are provided)
- [ ] Categorization failure does not prevent expense creation -- items default to "Uncategorized"

**Dependencies**: Task 4
**Complexity**: Small

---

## Task 6: Seed "Uncategorized" category on household creation

**Description**: When a new household is created, automatically seed the "Uncategorized" system category. This ensures the category always exists for new households (the migration handles existing ones).

**Acceptance Criteria**:
- [ ] `POST /api/v1/households` creates a row in `categories` with `name = 'Uncategorized'`, `is_system = true` for the new household
- [ ] The household creation endpoint still works correctly and returns the same response shape
- [ ] No duplicate "Uncategorized" category is created if called multiple times

**Dependencies**: Task 1
**Complexity**: Small

---

## Task 7: API endpoint -- update line item category (with learning)

**Description**: Create `PATCH /api/v1/households/:householdId/expenses/:expenseId/line-items/:lineItemId/category` endpoint. This is the user correction endpoint that updates a line item's category AND saves the mapping for future auto-categorization.

**Acceptance Criteria**:
- [ ] Accepts `{ "categoryName": "Coffee" }` in request body
- [ ] If the category exists (case-insensitive), uses it; otherwise creates a new category for the household
- [ ] Updates `line_items.category_id` for the specified line item
- [ ] Upserts `category_mappings` with the line item's description -> new category, `source: 'user'`
- [ ] A user-source mapping overwrites a previous ai-source mapping for the same description
- [ ] Returns `{ lineItemId, categoryId, categoryName, mappingSaved: true }`
- [ ] Validates: user is a member of the household, expense belongs to the household, line item belongs to the expense
- [ ] Returns 404 if line item, expense, or household not found; 403 if not a member

**Dependencies**: Task 2
**Complexity**: Small

---

## Task 8: API endpoints -- list, rename, merge, delete categories

**Description**: Create category management endpoints for household admins.

**Acceptance Criteria**:
- [ ] `GET /households/:householdId/categories` returns all categories with `mappingCount` (count of rows in `category_mappings` for each)
- [ ] `PATCH /households/:householdId/categories/:categoryId` renames a category; if the new name matches an existing category, merges: reassigns all mappings and line items from source to target, deletes source, returns `{ merged: true }`
- [ ] `DELETE /households/:householdId/categories/:categoryId` reassigns all line items and mappings to "Uncategorized", then deletes the category
- [ ] Cannot rename, merge into, or delete the "Uncategorized" system category -- returns `400 CANNOT_MODIFY_SYSTEM_CATEGORY`
- [ ] Rename and delete require admin role; list is available to all members
- [ ] Returns appropriate error codes for not found, forbidden, validation errors

**Dependencies**: Task 2, Task 6
**Complexity**: Medium

---

## Task 9: Statistics endpoint -- add category breakdown and trends

**Description**: Extend `GET /households/:householdId/statistics` to include `byCategory` and `categoryTrends` data.

**Acceptance Criteria**:
- [ ] Response includes `byCategory`: array of `{ categoryId, categoryName, totalOre, itemCount }` for the requested month, sorted by totalOre descending
- [ ] Items with no `category_id` (historical, pre-migration) are grouped under `categoryName: "Uncategorized"` with `categoryId: null`
- [ ] Response includes `categoryTrends`: last 6 months, each with a `byCategory` array of `{ categoryId, categoryName, totalOre }`
- [ ] Personal item filter applies to category stats the same way it applies to tag stats
- [ ] CSV export includes a `Category` column after the `Tag` column
- [ ] Performance: category queries use the `line_items(category_id)` index

**Dependencies**: Task 1
**Complexity**: Medium

---

## Task 10: Frontend -- category badge on line items (review screen + expense detail)

**Description**: Show the assigned category on each line item in the review screen (AddExpense) and the expense detail screen. "Uncategorized" items get a warning-styled badge. Tapping/clicking the badge opens a category selector.

**Acceptance Criteria**:
- [ ] Each line item row displays a category badge/pill next to the existing tag badge
- [ ] "Uncategorized" badge uses an amber/warning color to draw attention
- [ ] Other categories use a neutral color
- [ ] Tapping/clicking the badge opens a dropdown listing all household categories
- [ ] The dropdown includes a "New category..." option at the bottom
- [ ] Selecting "New category..." shows a text input; submitting creates the category and assigns it
- [ ] Selecting an existing category calls `PATCH .../line-items/:id/category` and updates the badge
- [ ] Works on both the receipt review screen (before confirming) and the expense detail screen (after confirming)
- [ ] Mobile-first: dropdown works well on 320px+ viewports

**Dependencies**: Task 5, Task 7
**Complexity**: Medium

---

## Task 11: Frontend -- category statistics charts

**Description**: Add category breakdown donut chart and category trend chart to the Statistics MonthlyOverview page.

**Acceptance Criteria**:
- [ ] "By Category" section appears after the existing "By Tag" section
- [ ] Donut chart (Recharts `PieChart`) shows category share for the current month
- [ ] Each segment is labeled with category name; tooltip shows name + amount in NOK
- [ ] Stacked bar chart (Recharts `BarChart`) shows per-category spend over last 6 months
- [ ] "Uncategorized" segment uses a grey/muted color
- [ ] Charts use the `byCategory` and `categoryTrends` data from the statistics endpoint
- [ ] Charts handle the case where no category data exists (pre-migration) gracefully -- shows empty state or "No category data yet"
- [ ] statsStore updated to include the new response fields

**Dependencies**: Task 9, Task 10
**Complexity**: Medium

---

## Task 12: Frontend -- category management in household settings

**Description**: Add a "Categories" section to household settings where the admin can view, rename, merge, and delete categories.

**Acceptance Criteria**:
- [ ] "Categories" section visible in household settings for all members
- [ ] Lists all categories with mapping count
- [ ] Admin sees rename and delete actions per category (except "Uncategorized")
- [ ] Rename: inline edit field; on submit calls PATCH; if merge occurs, shows confirmation before proceeding
- [ ] Delete: confirmation dialog; on confirm calls DELETE
- [ ] Non-admin members see the list but no edit/delete actions
- [ ] List updates after rename/merge/delete without full page reload

**Dependencies**: Task 8
**Complexity**: Medium
