# Implementation Plan: Expense Tracker App

**Branch**: `001-expense-tracker-app` | **Date**: 2026-03-29 | **Spec**: [spec.md](./spec.md)

## Summary

A shared household expense tracker with AI receipt parsing, monthly settlement calculation, project-based expense pools, and spending statistics. Built as a REST API (Node.js/Express/TypeScript) backed by PostgreSQL and MinIO, with a React web frontend and React Native iOS app. All services run via docker-compose. Financial calculations use integer arithmetic (øre). Realtime sync of shared expense state via WebSockets.

## Technical Context

**Language/Version**: TypeScript 5.4, Node.js 20 LTS (backend + shared), React 18 (web), React Native via Expo SDK 51 (iOS)
**Primary Dependencies**: Express 4, PostgreSQL 16, MinIO, Zustand, Recharts, Victory Native, ws (WebSocket), Resend (email), Expo Notifications
**Storage**: PostgreSQL 16 (relational data), MinIO (receipt images as S3-compatible object storage)
**Testing**: Vitest (unit + integration, backend and shared), React Testing Library (web), Jest + Expo (mobile)
**Target Platform**: Linux (docker-compose), iOS 16+ (React Native/Expo), modern browsers (Chrome, Safari, Firefox)
**Project Type**: Web service + mobile app + shared library
**Performance Goals**: Receipt parse response < 15s (Anthropic API bound), expense list load < 2s, realtime sync delivery < 3s
**Constraints**: All monetary values stored as integers (øre); no floating-point arithmetic in financial logic; no business logic in frontend
**Scale/Scope**: Household-scale (2–10 users per household); not designed for multi-tenant SaaS scale in V1

## Constitution Check

*GATE: Verified before Phase 0. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| API-First, Stateless Backend | PASS | All business logic in Express API; frontend is a pure consumer |
| Self-Hosted, Docker-Native | PASS | PostgreSQL, MinIO, API, web all in docker-compose; only Anthropic API + Resend are external |
| Financial Accuracy | PASS | All amounts in øre (integer); no float arithmetic anywhere in business logic |
| Mobile-First UI | PASS | Web built with TailwindCSS mobile-first breakpoints; React Native shares `shared/` package |
| Realtime Shared State | PASS | WebSocket server in Express app; emits events on expense confirm and settlement changes |

No violations. Complexity Tracking table not required.

## Project Structure

### Documentation (this feature)

```text
specs/001-expense-tracker-app/
├── plan.md              # This file
├── research.md          # Technology decisions and rationale
├── data-model.md        # Database schema and entity relationships
├── contracts/
│   └── api.md           # REST API endpoint contracts
└── tasks.md             # Created by /speckit.tasks
```

### Source Code (repository root)

```text
expense-tracker/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── routes/          # Express route handlers (auth, households, expenses, settlements, projects, statistics, users)
│   │   │   └── middleware/      # JWT auth, error handling, request validation
│   │   ├── services/            # Business logic (settlement calc, receipt parsing, notification dispatch)
│   │   ├── db/
│   │   │   ├── migrations/      # SQL migration files
│   │   │   └── queries/         # Typed SQL query functions (no ORM)
│   │   ├── storage/             # MinIO client wrapper (upload, signed URL generation)
│   │   ├── ws/                  # WebSocket server and event emitters
│   │   └── index.ts             # App entry point
│   ├── tests/
│   │   ├── unit/
│   │   └── integration/
│   └── package.json
│
├── web/
│   ├── src/
│   │   ├── components/          # Shared UI components
│   │   ├── pages/               # Route-level page components
│   │   ├── stores/              # Zustand stores
│   │   └── main.tsx
│   ├── tests/
│   └── package.json
│
├── mobile/
│   ├── src/
│   │   ├── screens/             # React Native screen components
│   │   ├── navigation/          # Expo Router navigation config
│   │   └── components/          # Mobile-specific UI components
│   ├── tests/
│   └── package.json
│
├── shared/
│   ├── src/
│   │   ├── calc/                # Settlement calculation, allocation key logic
│   │   ├── validation/          # Input validation schemas (Zod)
│   │   └── api-client/          # Typed REST client (used by web + mobile)
│   └── package.json
│
├── docker-compose.yml
├── docker-compose.override.yml  # Local dev overrides
└── .env.example
```

**Structure Decision**: Multi-package monorepo. Four packages: `backend`, `web`, `mobile`, `shared`. The `shared` package is the only place financial calculation logic lives — both web and mobile import from it. No ORM; all database access uses typed SQL query functions directly against the pg driver.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    docker-compose                        │
│                                                          │
│  ┌──────────┐   REST    ┌──────────────────────────┐    │
│  │   web    │──────────▶│        backend           │    │
│  │ (React)  │   WS      │  (Express / TypeScript)  │    │
│  └──────────┘◀──────────│                          │    │
│                          │  ┌────────┐ ┌────────┐  │    │
│  ┌──────────┐   REST    │  │  PostgreSQL  MinIO  │  │    │
│  │  mobile  │──────────▶│  └────────┘ └────────┘  │    │
│  │  (RN/    │   WS      └──────────────────────────┘    │
│  │  Expo)   │◀──────────         │          │            │
│  └──────────┘                    │          │            │
│                                  ▼          ▼            │
│                          Anthropic API   Resend          │
│                          (ext. service) (ext. service)   │
└─────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### No ORM
SQL queries are written directly using the `pg` driver with typed wrapper functions. Rationale: the data model is well-understood and stable; ORM magic is explicitly forbidden by the constitution. Migrations are plain SQL files run in sequence.

### Settlement Calculation (in `shared/calc/`)
The calculation is deterministic and pure (no side effects):
```
For each member:
  balance = amountPaidOre − round(totalHouseholdSpendOre × allocationShare)

Debt simplification:
  creditors = members where balance > 0 (sorted descending)
  debtors   = members where balance < 0 (sorted ascending)
  Greedy pairing: each debtor pays the largest available creditor first
  Produces minimum number of transactions
```
All values in øre (integers). Rounding uses `Math.round` with remainder assigned to the admin member.

### Realtime via WebSocket
The backend runs a WebSocket server alongside Express on the same port. On connection, the client authenticates with a JWT. The server maintains a map of `householdId → Set<WebSocket>`. Events are broadcast to all members of the relevant household:
- `expense.confirmed` — triggers expense list refresh
- `settlement.ready` — triggers settlement notification
- `settlement.transaction.updated` — updates transaction status in real time

### Receipt Parsing (server-side only)
1. Client uploads receipt image to `POST /receipts/parse` (multipart/form-data)
2. Backend stores the file to MinIO, then sends it to Anthropic API with a structured prompt
3. Response: `{ store, date, items: [{ description, quantity, unitPrice }], confidence }`
4. Low-confidence items are flagged; the parsed result is returned to the client for review
5. The MinIO key is returned so it can be attached to the confirmed expense

### Email via Resend
Three email templates: (1) household invite, (2) settlement ready, (3) reminder. Sent server-side only. No client-side email calls.
