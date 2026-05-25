# Feature Specification: Shared Household Expense Tracker

**Feature Branch**: `001-expense-tracker-app`
**Created**: 2026-03-29
**Status**: Draft

---

## User Scenarios & Testing

### User Story 1 — Household Setup & Onboarding (Priority: P1)

A new user creates an account, sets up a household, and invites their partner or flatmate to join. Once both members have joined, the household is active and ready for expense tracking.

**Why this priority**: The household is the core container for all shared data. Nothing else works until at least two members are in a household.

**Independent Test**: Can be fully tested by creating an account, creating a household, inviting a second user by email, and verifying the household becomes active when the second user accepts.

**Acceptance Scenarios**:

1. **Given** a new user with no account, **When** they register with a valid email and password, **Then** they are logged in and prompted to create a household.
2. **Given** a logged-in user on the household creation screen, **When** they enter a household name, address, and allocation key (default 50/50), **Then** the household is created with status "pending" (not yet active).
3. **Given** a household admin, **When** they invite a member by email, **Then** the invitee receives an email with a signup link pre-linked to that household.
4. **Given** an invitee who already has an account, **When** they click the invite link, **Then** they are prompted to log in and are added to the household directly (no new account created).
5. **Given** an invitee without an account, **When** they click the invite link, **Then** the signup form is pre-filled with the household association and they join on registration.
6. **Given** a household with fewer than 2 joined members, **When** any member tries to add an expense, **Then** they see a message that the household is not yet active.
7. **Given** a household where 2 or more members have joined, **Then** the household is active and expenses can be added.
8. **Given** a logged-in member, **When** they add their payment card(s) (last 4 digits + label), **Then** those cards are saved to their profile and used for purchaser detection.
9. **Given** a household admin, **When** they configure tags (default: Household, Personal) and personal keywords (e.g. "face mask"), **Then** those settings apply to all future expenses in the household.
10. **Given** an allocation key is set, **When** any member attempts to change it, **Then** only the household admin can save the change, and the new key applies only to future settlement periods — not retroactively.

---

### User Story 2 — Adding an Expense via Receipt Upload (Priority: P1)

A member uploads a photo of a grocery receipt. The app parses it into line items, auto-tags items matching personal keywords, and the member reviews and confirms before saving.

**Why this priority**: Receipt scanning is the primary input method and the core differentiator of the app.

**Independent Test**: Can be fully tested by uploading a receipt image, verifying line items are extracted, confirming the expense, and checking it appears in the household expense list.

**Acceptance Scenarios**:

1. **Given** a logged-in member, **When** they tap "Add Expense" and upload a receipt photo (JPG, PNG, or PDF), **Then** the app extracts line items with descriptions, quantities, and prices.
2. **Given** a parsed receipt, **When** a line item description matches a household personal keyword, **Then** that item is pre-tagged as "Personal" before the review screen.
3. **Given** the review screen, **When** the member changes the tag on a line item, **Then** the change overrides the auto-detected tag for that item only.
4. **Given** a receipt where card last 4 digits are visible, **When** the app detects a match with a saved member card, **Then** that member is pre-selected as the purchaser.
5. **Given** a receipt where no card is detected, **When** the member submits, **Then** the uploader is set as the purchaser by default, with an option to change.
6. **Given** a receipt the parser cannot fully read, **When** confidence is low for specific items, **Then** those items are flagged for manual review with empty or partial values; all other items are pre-filled.
7. **Given** a confirmed expense, **Then** it is saved with status "pending_review", the receipt image is stored, and the expense appears in the household expense list.
8. **Given** a member with no receipt available, **When** they select "Manual entry", **Then** they can enter store name, date, and line items by hand using the same review and tag flow.
9. **Given** any saved expense, **When** a member opens the expense detail, **Then** the original receipt image is viewable.

---

### User Story 3 — Monthly Settlement (Priority: P1)

> **Superseded in part by [spec 003-decouple-settlement](../003-decouple-settlement/spec.md)**: settlements are no longer bound to a calendar month. The admin triggers settlement on their own cadence and the system pulls in every confirmed-but-unsettled expense at that instant, regardless of when it was purchased. Statistics continue to bucket by `expense_date` month. The acceptance scenarios below still describe the math, but "for a month" should be read as "for the set of confirmed expenses at trigger time".

At the end of each month, the household admin triggers settlement. The app calculates who owes whom, shows the net amounts, and members pay each other manually via Vipps (the app shows the amount and recipient only — no payment link).

**Why this priority**: Settlement is the core value proposition — turning shared expense tracking into actionable, fair payment resolution.

**Independent Test**: Can be tested by confirming a set of expenses with known amounts and an allocation key, triggering settlement, and verifying the calculated balances and transaction pairs match the expected math.

**Acceptance Scenarios**:

1. **Given** confirmed household expenses for a month, **When** the household admin triggers settlement, **Then** the app calculates each member's total paid (Household-tagged items only) and net balance.
2. **Given** calculated balances, **Then** the app produces the minimum number of payment transactions needed to settle all debts.
3. **Given** a settlement summary, **Then** each transaction shows: payer name, recipient name, and amount in NOK.
4. **Given** a transaction in the settlement, **When** a member marks it as paid, **Then** the transaction is marked complete.
5. **Given** all transactions in a settlement are marked paid, **Then** the settlement period closes and is archived to history.
6. **Given** the settlement calculation: `balance = amountPaid − (totalHouseholdSpend × allocationKey)` — positive balance means the member is owed money; negative means the member owes money.
7. **Given** a settlement is ready, **Then** all household members receive an email notification.
8. **Given** a closed settlement, **When** any member views settlement history, **Then** they can see the full breakdown for that period.
9. **Given** a month with no confirmed household expenses, **When** settlement is triggered, **Then** the app shows a zero-balance summary and closes the period.
10. **Given** a non-admin member, **When** they attempt to trigger settlement, **Then** the action is not available to them.

---

### User Story 4 — Projects (Priority: P2)

Household members create a separate expense pool for a shared event (e.g. a vacation). Expenses are tracked the same way as household expenses. When the event ends, the admin settles the project separately from the monthly household cycle.

**Why this priority**: Projects are a key differentiator for friend groups and occasional shared events; they are self-contained and do not interfere with monthly household settlement.

**Independent Test**: Can be tested by creating a project, adding expenses to it, finishing the project, and verifying the settlement calculation is isolated from the household.

**Acceptance Scenarios**:

1. **Given** a logged-in member, **When** they create a project with a name, description, member subset, and allocation key, **Then** the project is created in "active" status.
2. **Given** an active project, **When** a member adds an expense, **Then** the same receipt upload and manual entry flow applies as for household expenses.
3. **Given** a project with a different allocation key than the household, **Then** all settlement calculations for that project use the project's own key.
4. **Given** the household admin on a project, **When** they trigger "Finish Project", **Then** the app calculates settlement for all project expenses using the same logic as monthly settlement.
5. **Given** a finished project, **Then** its status moves to "settling"; once all transactions are marked paid, it moves to "settled".
6. **Given** a settled project, **When** any member browses project history, **Then** the full expense list and settlement summary are viewable.
7. **Given** a project, **Then** its expenses do not appear in the monthly household settlement calculation.

---

### User Story 5 — Statistics (Priority: P2)

Members can view a monthly breakdown of household spending: total by category, by member contribution, and trends over time. Charts are interactive.

**Why this priority**: Statistics close the feedback loop and help members understand spending patterns. This is secondary to tracking and settling.

**Independent Test**: Can be tested by adding expenses across multiple categories and months, then verifying that chart data matches the raw expense totals.

**Acceptance Scenarios**:

1. **Given** confirmed household expenses, **When** a member opens the Statistics view, **Then** they see the current month's total spend broken down by tag/category and by member.
2. **Given** the monthly overview, **Then** a bar chart shows monthly totals stacked by category and a donut chart shows category share for the current month.
3. **Given** a category trend view, **Then** a line chart shows that category's spend over the last 6 months.
4. **Given** statistics, **Then** only Household-tagged expense items are included by default.
5. **Given** a member viewing statistics, **When** they toggle "include personal", **Then** their own personal items are added to the view (other members' personal items remain hidden).
6. **Given** any chart, **When** the member taps or hovers a data point, **Then** a detail tooltip shows the underlying value.
7. **Given** a member on the web app, **When** they request a CSV export, **Then** the current view's data downloads as a CSV file.

---

### Edge Cases

- An invitee who already has an account is added to the household without creating a duplicate account.
- A receipt image that is completely unreadable returns an empty parse with all items flagged for manual entry; the member can still save a manual expense.
- A settlement triggered when one member has a zero balance produces no transaction for that member.
- An expense with all items tagged as "Personal" contributes nothing to the household settlement calculation.
- A project where all members have equal spend produces a zero-balance settlement with no transactions required.
- A tag applied to an expense applies to all its line items by default; individual line items can override the tag.
- Deleting a member from a household is not supported in V1.

---

## Requirements

### Functional Requirements

- **FR-001**: The system MUST allow users to register with an email address and password.
- **FR-002**: The system MUST allow a registered user to create a household with a name, address, and allocation key.
- **FR-003**: The system MUST allow the household admin to invite members by email.
- **FR-004**: The system MUST send an email invite to the invitee with a link pre-associated to the household.
- **FR-005**: The household MUST NOT be usable for expense tracking until at least 2 members have joined.
- **FR-006**: The allocation key MUST be immutable for the current settlement period; changes apply only to future periods.
- **FR-007**: Members MUST be able to save payment cards (last 4 digits + label) to their profile.
- **FR-008**: The system MUST accept receipt uploads in JPG, PNG, and PDF formats.
- **FR-009**: The system MUST parse receipt images into structured line items (description, quantity, unit price) via AI.
- **FR-010**: Line items whose description matches a household personal keyword MUST be auto-tagged as "Personal" before user review.
- **FR-011**: The system MUST allow members to override the tag on individual line items during review.
- **FR-012**: The system MUST attempt to detect the purchaser from card last 4 digits visible on the receipt; if not detected, the uploader is the default purchaser.
- **FR-013**: Receipt images MUST be stored and remain viewable from the expense detail screen.
- **FR-014**: Expenses MUST follow the status lifecycle: pending_review → confirmed → settled.
- **FR-015**: The settlement calculation MUST use integer arithmetic and produce the minimum number of transactions.
- **FR-016**: Only the household admin MUST be able to trigger monthly settlement.
- **FR-017**: The system MUST notify all members by email when a settlement is ready.
- **FR-018**: Settlement history MUST be preserved and browsable.
- **FR-019**: Members MUST be able to create projects with a name, member subset, and allocation key independent from the household default.
- **FR-020**: Project expenses MUST be excluded from household monthly settlement calculations.
- **FR-021**: The system MUST display monthly statistics including: spend by category, spend by member, category trends over 6 months, and top items by spend and quantity.
- **FR-022**: Statistics MUST default to Household-tagged items only, with a toggle to include the viewing member's own personal items.
- **FR-023**: The web app MUST support CSV export of the current statistics view.
- **FR-024**: All charts MUST support tap/hover interaction showing the underlying value.
- **FR-025**: The system MUST support Norwegian, Swedish, and English receipt text in AI parsing.

### Key Entities

- **Household**: The shared space for two or more members. Has a name, address, allocation key, custom tags, and personal keywords. Has one admin.
- **Member**: A user belonging to a household. Has a profile, saved payment cards (last 4 digits + label), and a role (admin or member).
- **Expense**: A purchase record belonging to a household or project. Contains line items, a default tag, a purchaser, a receipt image reference, and a status.
- **Line Item**: A single product within an expense. Has a description, quantity, unit price, and a tag (inherits from expense, overridable per item).
- **Project**: A named expense pool with its own member subset, allocation key, and settlement lifecycle (active → settling → settled).
- **Settlement**: A record of a completed settlement period. Contains per-member balances and the resulting payment transactions (payer, recipient, amount).
- **Tag**: A label applied to an expense or line item (e.g. Household, Personal, or custom). Determines inclusion in settlement calculations.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: A member can upload a receipt photo and reach the review screen with parsed line items in under 15 seconds.
- **SC-002**: At least 90% of Norwegian supermarket receipts are parsed with all line items correctly extracted (no items missing or misread).
- **SC-003**: A household admin can complete the monthly settlement process (trigger → review balances → all transactions marked paid) in under 5 minutes.
- **SC-004**: All household members see an updated expense list within 3 seconds of another member confirming an expense.
- **SC-005**: A new user can complete household setup and invite their first co-member in under 5 minutes.
- **SC-006**: Settlement calculation produces correct results for all tested household configurations, verified against manual calculations.

---

## Assumptions

- All monetary amounts are in NOK. Multi-currency support is out of scope for V1.
- Members have a stable internet connection. Offline expense entry is out of scope for V1.
- Vipps payment is manual — the app shows who owes whom and how much; no Vipps API integration in V1.
- Receipt image storage retention and GDPR compliance policies are deferred to V2.
- Android support is out of scope for V1. The app targets web (mobile-first) and iOS only.
- Personal projects (hidden from other members, no settlement) are out of scope for V1.
- Bank or card automatic import is out of scope for V1.
- A household has exactly one admin in V1. Admin transfer is not supported.
- Allocation keys support arbitrary splits across any number of members summing to 100%.
- All monetary amounts are stored in the smallest currency unit (øre) to avoid rounding errors.
