# Expense Tracker

A self-hosted shared household expense tracker. Four-package npm workspace monorepo.

## Packages

| Package | Purpose |
|---------|---------|
| `backend/` | Express 4 + TypeScript REST API |
| `web/` | React 18 + Vite + TailwindCSS web app |
| `mobile/` | Expo SDK 51 iOS app (React Native) |
| `shared/` | Settlement calculator + typed API client (shared by web + mobile) |

## Key Technology Decisions

- **PostgreSQL 16** via plain `pg` driver — no ORM. Typed queries via `db.query<T>()` wrapper in `backend/src/db/client.ts`
- **JWT auth**: 15min access token (Bearer) + 30-day rotating refresh token (httpOnly cookie)
- **Monetary amounts**: all stored and computed as integers in øre (100 øre = 1 NOK). Non-integer amounts are rejected
- **Settlement algorithm**: pure integer arithmetic, greedy minimum-transactions, rounding remainder to admin. Lives in `shared/src/calc/settlement.ts`
- **Receipt parsing**: OpenAI `gpt-4o-mini` multimodal, 15s timeout, fallback returns empty items
- **Image uploads**: every receipt/avatar is re-encoded via `sharp` to strip metadata (incl. GPS EXIF), validate it's a real image, and cap dimensions
- **File storage**: MinIO (S3-compatible). Signed URLs expire 1h

## Getting Started

```bash
# Install all workspace dependencies
npm install

# Copy environment variables and fill in values
cp .env.example .env

# Run database migrations
cd backend && npm run migrate

# Start development (hot-reload via docker-compose.override.yml)
docker-compose up
```

### Required environment variables

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`

## Commands

```bash
# Backend only
cd backend && npm run dev

# Web only
cd web && npm run dev

# Lint + format check
npm run lint && npm run format:check

# Build all packages
npm run build

# Run tests (backend needs Postgres on :5432; uses its own expense_tracker_test DB)
npm test
```

## Security

- [`AUTHORIZATION.md`](./AUTHORIZATION.md) — the role × resource × operation access-control matrix
- [`THREAT-MODEL.md`](./THREAT-MODEL.md) — trust boundaries, assets, and threat mitigations

## Specification

Built with Spec-Driven Development (SDD). Full specification in
[`../specs/001-expense-tracker-app/`](../specs/001-expense-tracker-app/):
`spec.md` (user stories), `plan.md` (architecture), `tasks.md` (69 tasks, all complete).
