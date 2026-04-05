# expense-tracker

A self-hosted shared household expense tracker. Four-package npm workspace monorepo.

## Packages

| Package | Purpose |
|---------|---------|
| `backend/` | Express 4 + TypeScript REST API + WebSocket server |
| `web/` | React 18 + Vite + TailwindCSS web app |
| `mobile/` | Expo SDK 51 iOS app (React Native) |
| `shared/` | Settlement calculator + typed API client (shared by web + mobile) |

## Key Technology Decisions

- **PostgreSQL 16** via plain `pg` driver — no ORM. Typed queries via `db.query<T>()` wrapper in `backend/src/db/client.ts`
- **JWT auth**: 15min access token (Bearer) + 30-day rotating refresh token (httpOnly cookie)
- **Monetary amounts**: all stored and computed as integers in øre (100 øre = 1 NOK). Non-integer amounts are rejected
- **Settlement algorithm**: pure integer arithmetic, greedy minimum-transactions, rounding remainder to admin. Lives in `shared/src/calc/settlement.ts`
- **Receipt parsing**: OpenAI `gpt-4o-mini` multimodal, 15s timeout, fallback returns empty items. `backend/src/services/receiptParser.ts`
- **File storage**: MinIO (S3-compatible). Signed URLs expire 1h. `backend/src/storage/minio.ts`
- **Realtime sync**: WebSocket server in `backend/src/ws/server.ts`, household-scoped rooms

## Project Structure

```
backend/src/
  api/
    routes/        auth, users, households, receipts, expenses, settlements, projects, statistics
    middleware/    auth.ts (JWT), error.ts (AppError → JSON)
  db/
    client.ts      typed pg wrapper
    migrate.ts     migration runner
    migrations/    001_create_all_tables.sql, 002_create_indexes.sql
  services/        email.ts, receiptParser.ts, tagMatcher.ts, notifications.ts
  storage/         minio.ts
  ws/              server.ts

web/src/
  pages/
    Auth/          Register, Login, AcceptInvite
    Onboarding/    CreateHousehold
    Expenses/      ExpenseList, ExpenseDetail, AddExpense
    Settlement/    CurrentMonth, History
    Projects/      ProjectList, ProjectDetail, CreateProject
    Settings/      MembersAndCards
    Statistics/    MonthlyOverview, CategoryTrends
  components/      AuthShell, Button, FormField
  stores/          authStore, householdStore, expenseStore, settlementStore, projectStore, statsStore
  App.tsx          React Router routes + auth guards

shared/src/
  api-client/      index.ts — typed fetch wrapper, 401 auto-refresh
  calc/            settlement.ts — calculateSettlement()

mobile/src/        Expo Router screens (iOS only)
```

## Commands

```bash
# Install all workspace dependencies
npm install

# Run database migrations
cd backend && npm run migrate

# Start development (hot-reload via docker-compose.override.yml)
docker-compose up

# Backend only
cd backend && npm run dev

# Web only
cd web && npm run dev

# Lint + format check
npm run lint && npm run format:check

# Build all packages
npm run build
```

## Environment Variables

Copy `.env.example` → `.env` and fill in values before running.

Required: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`

## Financial Accuracy Rules (NON-NEGOTIABLE)

1. All amounts are stored as integers in **øre** — never floats
2. Settlement shares use **basis points** (10,000 = 100%)
3. Rounding remainder always goes to the **admin** (first member)
4. The `unitPriceOre` field must pass `Number.isInteger()` — the API rejects floats with 400

## SDD Artifacts

Full specification in `../specs/001-expense-tracker-app/`:
- `.specify/constitution.md` — project rules and tech stack
- `spec.md` — user stories and acceptance criteria
- `plan.md` — architecture decisions
- `tasks.md` — 69 tasks, all complete ✓
