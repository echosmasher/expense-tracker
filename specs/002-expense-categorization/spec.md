# Feature Specification: Expense Categorization

**Feature Branch**: `002-expense-categorization`
**Created**: 2026-04-06
**Status**: Draft
**Depends on**: 001-expense-tracker-app (receipt parsing, line items, statistics)

---

## Summary

Automatically categorize receipt line items into product categories (e.g. "Coffee", "Cleaning Supplies", "Hygiene") so the Statistics view can show spending broken down by category. The system learns from user corrections: once a user assigns a category to an uncategorized item, that mapping is remembered for the household and applied automatically to future receipts.

## Business Value

The current Statistics view groups spending by tag (Household/Personal) and by member, but cannot answer "how much do we spend on coffee per month?" or "what share of our budget goes to cleaning supplies?". Product-level categorization closes this gap and makes the spending breakdown actionable.

---

## User Stories

### User Story 1 -- Automatic Categorization on Receipt Upload (Priority: P1)

When a receipt is parsed, the system assigns a product category to each line item. Items that match a known mapping in the household are categorized instantly. Items with no known mapping are categorized by AI. Items the AI cannot confidently categorize are marked "Uncategorized".

**Acceptance Scenarios**:

1. **Given** a parsed receipt with the line item "KAFFE 450 G FILTERMALT", **When** the household has no existing mapping for this item, **Then** the system uses AI to categorize it and assigns "Coffee".
2. **Given** a parsed receipt with the line item "KAFFE 450 G MELLANROST", **When** the household already has a mapping for this item (from a previous receipt or correction), **Then** the saved category is applied without an AI call.
3. **Given** a parsed receipt with an ambiguous item the AI cannot confidently categorize, **Then** the item is assigned the category "Uncategorized" and visually flagged on the review screen.
4. **Given** a parsed receipt with 10 line items where 7 have saved mappings and 3 do not, **Then** only the 3 unmapped items are sent to the AI for categorization.
5. **Given** categorization results, **Then** each line item on the review screen shows its assigned category alongside the existing tag (Household/Personal).
6. **Given** a line item categorized by AI with high confidence, **Then** the mapping (item description -> category) is saved to the household for future use.

---

### User Story 2 -- User Correction of Categories (Priority: P1)

A user can change the category of any line item during the review step or from the expense detail screen. Corrections update the household's category mappings so the same item is categorized correctly in the future.

**Acceptance Scenarios**:

1. **Given** a line item marked "Uncategorized", **When** the user selects a category from the existing list, **Then** the item is updated and the mapping is saved for the household.
2. **Given** a line item marked "Uncategorized", **When** the user types a new category name that does not exist yet, **Then** the new category is created for the household and the mapping is saved.
3. **Given** a line item the AI categorized as "Beverages", **When** the user changes it to "Coffee", **Then** the mapping is updated and future items with the same description use "Coffee".
4. **Given** a saved mapping for "BLUE JAVA" -> "Coffee", **When** a future receipt contains "BLUE JAVA", **Then** it is automatically categorized as "Coffee" without AI or user intervention.
5. **Given** the review screen, **When** the user changes a category, **Then** only that line item's category changes -- other items on the same receipt are not affected.

---

### User Story 3 -- Category Statistics (Priority: P2)

The Statistics view shows spending broken down by product category: a donut chart for the current month and a trend chart over time.

**Acceptance Scenarios**:

1. **Given** confirmed expenses with categorized line items, **When** a member opens Statistics, **Then** they see a donut chart showing spend share per category for the current month.
2. **Given** the category breakdown, **Then** a bar or line chart shows per-category spend over the last 6 months.
3. **Given** the category view, **Then** "Uncategorized" items appear as their own segment in the charts.
4. **Given** a member taps/hovers a category segment in any chart, **Then** a tooltip shows the category name and total amount.
5. **Given** the existing tag-based statistics, **Then** category statistics appear as an additional section -- they do not replace the tag breakdown.
6. **Given** a CSV export, **Then** the category column is included alongside the existing tag column.

---

### User Story 4 -- Category Management (Priority: P3)

The household admin can view and manage the list of categories and their mappings.

**Acceptance Scenarios**:

1. **Given** the household settings, **Then** there is a "Categories" section listing all categories with the count of mapped items per category.
2. **Given** the category list, **When** the admin renames a category, **Then** all line items and mappings using that category are updated.
3. **Given** the category list, **When** the admin merges two categories (e.g. merges "Coffee" into "Hot Beverages"), **Then** all mappings and line items are reassigned to the target category and the source category is deleted.
4. **Given** the category list, **When** the admin deletes a category, **Then** all items mapped to it become "Uncategorized" and the mappings are removed.

---

## Edge Cases

- A line item description that is an exact match to a saved mapping uses the saved mapping, even if AI would categorize it differently.
- A line item description with minor variations (e.g. "KAFFE 450G FILTERMALT" vs "KAFFE 450 G FILTERMALT") may not match an existing mapping. The system does not fuzzy-match in V1 -- exact normalized match only (case-insensitive, trimmed whitespace).
- If the AI categorization API call fails or times out, all uncategorized items remain "Uncategorized" -- the user can still manually categorize them.
- A category with zero mapped items is still visible in the category list until explicitly deleted.
- Category names are unique per household (case-insensitive). Creating "coffee" when "Coffee" exists reuses the existing category.
- Renaming a category to an existing category name is treated as a merge.
- "Uncategorized" is a system category that cannot be renamed, deleted, or merged into.

---

## Out of Scope (V1)

- Fuzzy matching or similarity-based matching of item descriptions (exact normalized match only)
- Global/cross-household category sharing or suggestions
- Pre-seeded category lists (households start with only "Uncategorized"; categories emerge from use)
- Automatic re-categorization of historical line items when a mapping is added (only future items benefit)
- Sub-categories or category hierarchies
- Category-based budget limits or alerts
- Barcode or EAN-based product lookup

---

## Non-Functional Requirements

- AI categorization of a batch of items must complete within the existing 15-second receipt parse timeout (categorization runs as part of the same flow or as a fast follow-up call).
- Category mappings must be queryable in O(1) per item (indexed lookup by household + normalized description).
- The Statistics view must not degrade in performance when categories are added.
