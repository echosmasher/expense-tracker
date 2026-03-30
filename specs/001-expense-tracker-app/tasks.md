# Tasks: Expense Tracker App

**Input**: Design documents from `/specs/001-expense-tracker-app/`
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/api.md ✅

**Organization**: Tasks grouped by user story for independent implementation and testing.
**Tests**: Not included (not requested in spec).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story this task belongs to (US1–US5)

---

## Phase 1: Setup

**Purpose**: Monorepo scaffold, tooling, and docker-compose infrastructure

- [x] T001 Initialise npm workspace monorepo with four packages: `backend/`, `web/`, `mobile/`, `shared/` — create root `package.json` with workspaces config and `tsconfig.base.json`
- [x] T002 [P] Scaffold `backend/` package — `package.json`, `tsconfig.json`, `src/index.ts` entry point with Express app skeleton
- [x] T003 [P] Scaffold `shared/` package — `package.json`, `tsconfig.json`, `src/index.ts` — export stubs for `calc/`, `validation/`, `api-client/`
- [x] T004 [P] Scaffold `web/` package — Vite + React 18 + TypeScript, TailwindCSS, Zustand — `package.json`, `vite.config.ts`, `index.html`
- [x] T005 [P] Scaffold `mobile/` package — Expo SDK 51 + React Native + TypeScript — initialise with `expo init` equivalent, add Victory Native
- [x] T006 Write `docker-compose.yml` with four services: `db` (postgres:16), `storage` (minio/minio), `api` (backend), `web` — with volumes and env var placeholders
- [x] T007 Write `.env.example` with all required environment variables: `DATABASE_URL`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`
- [x] T008 [P] Configure ESLint + Prettier at root level, shared config inherited by all packages

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before any user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T009 Set up PostgreSQL migration system in `backend/src/db/migrations/` — write migration runner script (`backend/src/db/migrate.ts`) that applies numbered SQL files in sequence
- [x] T010 Write initial migration `001_create_all_tables.sql` — all tables from data-model.md: `users`, `refresh_tokens`, `cards`, `households`, `household_members`, `invites`, `allocation_keys`, `allocation_key_shares`, `tags`, `personal_keywords`, `expenses`, `line_items`, `projects`, `project_members`, `settlements`, `settlement_balances`, `settlement_transactions`
- [x] T011 Write migration `002_create_indexes.sql` — all indexes from data-model.md
- [x] T012 Implement typed PostgreSQL query wrapper in `backend/src/db/client.ts` — exports a `db` client using the `pg` Pool, with typed `query<T>()` helper function
- [x] T013 Implement Express app setup in `backend/src/index.ts` — register middleware: JSON body parser, cookie parser, CORS, request logger; mount `/api/v1` router; start HTTP server; attach WebSocket server to the same HTTP server
- [x] T014 Implement JWT auth middleware in `backend/src/api/middleware/auth.ts` — verifies Bearer token, attaches `req.user` with `{ userId, householdId }`, returns `401` on failure
- [x] T015 Implement global error handler middleware in `backend/src/api/middleware/error.ts` — catches thrown errors, maps to `{ error: { code, message } }` JSON response with correct HTTP status
- [x] T016 Implement MinIO client wrapper in `backend/src/storage/minio.ts` — exports `uploadFile(key, buffer, mimetype)` and `getSignedUrl(key, expirySeconds)` using `@aws-sdk/client-s3`
- [x] T017 Implement settlement calculation function in `shared/src/calc/settlement.ts` — pure function: takes `expenses[]`, `allocationKeyShares[]` → returns `balances[]` and `transactions[]` (minimum transactions, integer øre arithmetic, rounding remainder to admin)
- [x] T018 Implement WebSocket server in `backend/src/ws/server.ts` — auth handshake on connect (JWT), household-scoped rooms map, `broadcast(householdId, event)` helper
- [x] T019 Implement shared API client in `shared/src/api-client/index.ts` — typed fetch wrapper for all endpoints, handles token refresh on 401, exports typed functions matching contracts/api.md
- [x] T020 [P] Implement Zustand store shells in `web/src/stores/` — `authStore`, `householdStore`, `expenseStore`, `settlementStore`, `projectStore`, `statsStore`; WebSocket event handler wiring (stores are populated with data in each user story phase)

**Checkpoint**: Foundation complete — user story implementation can begin

---

## Phase 3: User Story 1 — Household Setup & Onboarding (Priority: P1) 🎯 MVP

**Goal**: New user registers, creates a household, invites a member, member joins — household becomes active

**Independent Test**: Register two users via API, create household, send invite, accept invite — verify household status changes to `active`

### Implementation

- [x] T021 [P] [US1] Implement `POST /auth/register` in `backend/src/api/routes/auth.ts` — validate input with Zod, hash password with bcrypt (12 rounds), insert user, issue access + refresh tokens, set httpOnly cookie
- [x] T022 [P] [US1] Implement `POST /auth/login` in `backend/src/api/routes/auth.ts` — verify credentials, issue tokens
- [x] T023 [P] [US1] Implement `POST /auth/refresh` and `POST /auth/logout` in `backend/src/api/routes/auth.ts` — refresh token rotation, revocation
- [x] T024 [US1] Implement `POST /auth/accept-invite` in `backend/src/api/routes/auth.ts` — validate invite token, create account if new user, add to household, activate household if member count ≥ 2 (depends on T021, T027)
- [x] T025 [P] [US1] Implement `GET /users/me`, `PATCH /users/me` in `backend/src/api/routes/users.ts`
- [x] T026 [P] [US1] Implement `POST /users/me/cards` and `DELETE /users/me/cards/:cardId` in `backend/src/api/routes/users.ts`
- [x] T027 [US1] Implement `POST /households` in `backend/src/api/routes/households.ts` — create household + allocation_key + allocation_key_shares + seed default tags (Household, Personal); set `households.current_allocation_key_id` in same transaction (depends on T012)
- [x] T028 [US1] Implement `GET /households/:householdId` in `backend/src/api/routes/households.ts` — return full household object with members, allocation key, tags, personal keywords (depends on T027)
- [x] T029 [US1] Implement `PATCH /households/:householdId` in `backend/src/api/routes/households.ts` — admin-only; update name/address/keywords/tags; new allocation key insert + update `current_allocation_key_id` (does not mutate current key; new key applies to future periods only) (depends on T027)
- [x] T030 [US1] Implement `POST /households/:householdId/invites` in `backend/src/api/routes/households.ts` — admin-only; generate secure token, insert invite row, send invite email via Resend (depends on T027)
- [x] T031 [P] [US1] Implement invite email template in `backend/src/services/email.ts` — Resend SDK, household invite template
- [x] T032 [P] [US1] Wire auth and household routes into Express router in `backend/src/api/router.ts`
- [x] T033 [US1] Implement household screen flow in `web/src/pages/` — Register, Login, CreateHousehold, AcceptInvite pages; uses authStore + householdStore from T020; API client calls from shared/src/api-client/ via T019 (depends on T021–T030)
- [x] T034 [US1] Implement member cards setup screen in `web/src/pages/Settings/MembersAndCards.tsx` — list cards, add card form, delete card (depends on T025, T026)

**Checkpoint**: Register → create household → invite → accept → household active ✅

---

## Phase 4: User Story 2 — Adding an Expense via Receipt Upload (Priority: P1)

**Goal**: Member uploads receipt → AI parses it → member reviews line items → confirms expense → appears in expense list with realtime update

**Independent Test**: Upload a test receipt image, verify parsed line items appear for review, confirm expense, verify it appears in GET /expenses and other household members receive WebSocket event

### Implementation

- [x] T035 [US2] Implement `POST /receipts/parse` in `backend/src/api/routes/receipts.ts` — accept multipart upload, validate file type + size (max 10MB), upload to MinIO, call Anthropic API with structured prompt, match card last four digits against household member cards, return parsed result + receiptImageKey (depends on T016, T018)
- [x] T036 [P] [US2] Implement Anthropic receipt parsing service in `backend/src/services/receiptParser.ts` — multimodal prompt in Norwegian/Swedish/English (FR-025: system prompt must instruct model to handle all three languages); structured JSON output `{ store, date, items[{ description, quantity, unitPrice, confidenceLow }] }`; 15s timeout (SC-001) with `Promise.race`; fallback returns empty items array on timeout or API failure
- [x] T037 [P] [US2] Implement personal keyword auto-tagging logic in `backend/src/services/tagMatcher.ts` — given line items + household personal keywords, returns items with `isPersonal` flag set
- [x] T038 [US2] Implement `POST /households/:householdId/expenses` in `backend/src/api/routes/expenses.ts` — validate all monetary values as integers (øre); reject if non-integer amount received; insert expense + line items, apply personal keyword auto-tagging (depends on T035, T037)
- [x] T039 [US2] Implement `GET /households/:householdId/expenses` in `backend/src/api/routes/expenses.ts` — filter by month and status query params; enforce household-must-be-active check (`403 HOUSEHOLD_NOT_ACTIVE` if status = pending) (depends on T038)
- [x] T040 [US2] Implement `GET /households/:householdId/expenses/:expenseId` in `backend/src/api/routes/expenses.ts` — return full expense with line items and signed receipt image URL (depends on T016, T038)
- [x] T041 [US2] Implement `POST /households/:householdId/expenses/:expenseId/confirm` in `backend/src/api/routes/expenses.ts` — transition status pending_review → confirmed, broadcast `expense.confirmed` WebSocket event (depends on T038, T018)
- [x] T042 [US2] Implement receipt upload + review screen in `web/src/pages/Expenses/AddExpense.tsx` — file picker, call parse endpoint, show line item review table with tag overrides, purchaser selector, confirm button; uses expenseStore from T020 (depends on T035–T041)
- [x] T043 [US2] Implement expense list page in `web/src/pages/Expenses/ExpenseList.tsx` and expense detail page `ExpenseDetail.tsx` — connect to expenseStore, WebSocket event handler updates list in real time (depends on T039, T040)

**Checkpoint**: Upload receipt → parse → review → confirm → realtime sync ✅

---

## Phase 5: User Story 3 — Monthly Settlement (Priority: P1)

**Goal**: Admin triggers settlement → app calculates minimum transactions → members see who owes whom → mark transactions paid → settlement closes

**Independent Test**: Seed confirmed expenses for two members with known amounts + allocation key, trigger settlement, verify calculated balances and transactions match expected math, mark all transactions paid, verify status becomes `completed`

### Implementation

- [x] T044 [US3] Implement `POST /households/:householdId/settlements` in `backend/src/api/routes/settlements.ts` — admin-only; query all confirmed household-tagged expenses for previous month; call settlement calc from `shared/src/calc/settlement.ts`; snapshot `current_allocation_key_id` at trigger time into settlement row (not re-derived later); insert settlement, balances, transactions; broadcast `settlement.ready` WebSocket event; send settlement email to all members (depends on T017, T030, T041)
- [x] T045 [US3] Implement `GET /households/:householdId/settlements` and `GET /households/:householdId/settlements/:settlementId` in `backend/src/api/routes/settlements.ts` (depends on T044)
- [x] T046 [US3] Implement `PATCH /settlements/:settlementId/transactions/:transactionId` in `backend/src/api/routes/settlements.ts` — mark paid, check if all transactions paid → auto-close settlement to `completed`, mark expense statuses as `settled`, broadcast WebSocket event (depends on T044)
- [x] T047 [P] [US3] Implement settlement ready email template in `backend/src/services/email.ts` — list of transactions with amounts (depends on T031)
- [x] T048 [US3] Implement settlement screen in `web/src/pages/Settlement/CurrentMonth.tsx` — shows per-member balances, transaction list with payer/recipient/amount, mark-as-paid button; uses settlementStore from T020 (depends on T044–T046)
- [x] T049 [US3] Implement settlement history screen in `web/src/pages/Settlement/History.tsx` — list of past settlements with drill-down (depends on T045)

**Checkpoint**: Trigger → calculate → view balances → mark paid → period closes ✅

---

## Phase 6: User Story 4 — Projects (Priority: P2)

**Goal**: Create a project with its own member subset and allocation key → add expenses → finish project → settlement calculated separately from household

**Independent Test**: Create a project, add expenses, call finish-project endpoint, verify settlement is isolated from household settlement data

### Implementation

- [x] T050 [P] [US4] Implement `POST /households/:householdId/projects` in `backend/src/api/routes/projects.ts` — create project + own allocation_key + project_members rows (depends on T012)
- [x] T051 [P] [US4] Implement `GET /households/:householdId/projects` and `GET /projects/:projectId` in `backend/src/api/routes/projects.ts`
- [x] T052 [US4] Implement `POST /projects/:projectId/expenses` and `GET /projects/:projectId/expenses` in `backend/src/api/routes/projects.ts` — reuse expense insertion logic, scoped to project (depends on T038, T050)
- [x] T053 [US4] Implement `POST /projects/:projectId/finish` in `backend/src/api/routes/projects.ts` — admin-only; transition project to `settling`; run settlement calc using project's allocation key; insert settlement scoped to projectId (depends on T017, T050, T052)
- [x] T054 [US4] Implement projects list screen in `web/src/pages/Projects/ProjectList.tsx` and project detail screen `ProjectDetail.tsx` — add expense flow reused from US2; uses projectStore from T020 (depends on T042, T050–T053)
- [x] T055 [US4] Implement create project screen in `web/src/pages/Projects/CreateProject.tsx` — member selector (subset of household), allocation key input (depends on T050)

**Checkpoint**: Create project → add expenses → finish → settlement isolated ✅

---

## Phase 7: User Story 5 — Statistics (Priority: P2)

**Goal**: Member views monthly spend by category and member contribution, category trends, interactive charts, CSV export

**Independent Test**: Seed expenses across multiple categories and months, verify chart data from API matches raw totals, verify CSV export contains correct rows

### Implementation

- [x] T056 [US5] Implement `GET /households/:householdId/statistics` in `backend/src/api/routes/statistics.ts` — aggregate confirmed expenses: total by tag, total by member, top items, 6-month trend by tag; respect `includePersonal` query param (only current user's personal items) (depends on T041)
- [x] T057 [US5] Implement `GET /households/:householdId/statistics/export` in `backend/src/api/routes/statistics.ts` — same aggregation logic, serialize to CSV, set Content-Disposition header (depends on T056)
- [x] T058 [US5] Implement monthly overview screen in `web/src/pages/Statistics/MonthlyOverview.tsx` — stacked bar chart (Recharts), donut chart, member contribution list; tap/hover tooltips; uses statsStore from T020 (depends on T056)
- [x] T059 [US5] Implement category trends screen in `web/src/pages/Statistics/CategoryTrends.tsx` — line chart (Recharts) for selected category over 6 months (depends on T056)
- [x] T060 [US5] Add CSV export button to statistics page — calls export endpoint, triggers browser download (depends on T057)

**Checkpoint**: Statistics with correct data, interactive charts, CSV download ✅

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: iOS app, app-level navigation, shared API client, and production readiness

- [x] T061 [P] Implement app navigation in `web/src/App.tsx` — React Router routes matching the navigation structure from spec (Auth, Home, Expenses, Settlement, Projects, Statistics, Settings)
- [x] T062 [P] Implement mobile navigation in `mobile/src/navigation/` — Expo Router stack navigator, same screen structure as web
- [x] T063 [P] Implement iOS receipt upload screen in `mobile/src/screens/AddExpense/` — camera + file picker (Expo ImagePicker), calls shared API client parse endpoint, review screen with same tag-override flow
- [x] T064 [P] Implement iOS settlement screen in `mobile/src/screens/Settlement/` — shows transactions, mark-as-paid button (depends on T048 design)
- [x] T065 [P] Implement Expo push notification handler in `mobile/src/notifications/` — register APNs token on login, handle `settlement.ready` push notification
- [x] T066 Wire APNs push notification dispatch in `backend/src/services/notifications.ts` — send push to all iOS household members on `settlement.ready` event (depends on T044)
- [x] T067 [P] Finalize `docker-compose.yml` — health checks, restart policies, named volumes for PostgreSQL and MinIO data persistence, production-safe env var handling
- [x] T068 [P] Write `docker-compose.override.yml` for local dev — bind mounts for hot reload, expose ports for direct DB/MinIO access
- [x] T069 [P] Update `CLAUDE.md` in expense-tracker root with final monorepo structure (`backend/`, `web/`, `mobile/`, `shared/`), run commands, and package scripts

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — all T001–T008 can start immediately; T002–T005 and T008 are parallel
- **Phase 2 (Foundational)**: Depends on Phase 1 — **BLOCKS all user stories**; T009–T012 sequential, T013–T020 can be mostly parallel after T012
- **Phase 3 (US1)**: Depends on Phase 2 — T021–T023 parallel; T024 depends on T021+T027; T027 after T012; T033 depends on T021–T030
- **Phase 4 (US2)**: Depends on Phase 2 + T027 (household exists); T035–T037 parallel; T038 after T035+T037; T042–T043 after T038–T041
- **Phase 5 (US3)**: Depends on T041 (confirmed expenses), T017 (calc), T030 (email)
- **Phase 6 (US4)**: Depends on Phase 2 + T038 (expense insertion logic)
- **Phase 7 (US5)**: Depends on T041 (confirmed expenses exist)
- **Phase 8 (Polish)**: Depends on all user story phases

### Parallel Opportunities Per Phase

**Phase 1**: T002, T003, T004, T005, T008 all parallel after T001
**Phase 2**: T013, T014, T015, T016, T017, T018, T019, T020 all parallel after T012
**Phase 3 (US1)**: T021, T022, T023, T025, T026, T031 all parallel; T027 after T012; T028–T030 after T027
**Phase 4 (US2)**: T035, T036, T037 parallel; T038 after T035+T037; T039–T041 after T038
**Phase 6 (US4)**: T050, T051 parallel immediately; T052 after T050
**Phase 8**: T061, T062, T063, T064, T065, T067, T068, T069 all parallel

---

## Implementation Strategy

### MVP Scope (Phases 1–5 only)

1. Phase 1: Setup
2. Phase 2: Foundational
3. Phase 3: US1 — Household onboarding
4. Phase 4: US2 — Receipt upload + expense entry
5. Phase 5: US3 — Monthly settlement
6. **STOP and validate**: all three P1 stories work end-to-end on web
7. Deploy MVP

### Incremental Delivery After MVP

8. Phase 6: US4 — Projects
9. Phase 7: US5 — Statistics
10. Phase 8: Polish + iOS app

### Single Developer Sequence

T001 → T002–T005 (parallel) → T006–T008 → T009–T020 → T021–T034 → T035–T043 → T044–T049 → T050–T055 → T056–T060 → T061–T069

---

## Notes

- All monetary amounts: integers in øre throughout — no `parseFloat`, no `toFixed` in business logic
- Financial calc lives only in `shared/src/calc/settlement.ts` — both web and mobile import from there
- No ORM — all DB access through typed query functions in `backend/src/db/queries/`
- Frontend-design skill should be invoked before implementing any React or React Native UI components
- Vipps: display payer/recipient/amount only — no link, no API call
- Receipt image access: always via signed MinIO URL (1h expiry), never a direct public URL
