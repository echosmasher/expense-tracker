<!-- SYNC IMPACT REPORT
Version change: 1.0.0 → 2.0.0
Amendment rationale: Specs 004 (mobile client) and 005 (multi-currency) commit the project to a
  web-only PWA rather than a native iOS app, and to OpenAI as the receipt-parsing provider (the
  code has used it since spec 001; the constitution never reflected that). This amendment corrects
  the constitution to describe the system as it is and as those specs define its target state, so
  the public repository's stated principles no longer contradict the code.
Removed principles: V. Realtime Shared State (never implemented; dropped rather than left as a
  false claim)
Modified principles:
  - II. Self-Hosted, Docker-Native Deployment (AI provider corrected to OpenAI; APNs dropped)
  - III. Financial Accuracy (extended to minor-unit integers for any currency, per spec 005's
    scaled-integer rates)
  - IV. Mobile-First UI (renamed scope: web app is the phone client; React Native and the
    shared-package-with-mobile clause removed)
Modified sections:
  - Technology Stack: iOS client section removed; WebSocket/SSE and APNs entries removed; AI
    provider corrected to OpenAI `gpt-4o-mini`
  - Development Standards → Authentication: unauthenticated routes now `login`, `refresh`,
    `accept-invite`, `invite-info`; `register` removed, invitation stated as the sole
    account-creation path
  - Technology Stack → Forbidden Patterns: "Offline expense entry" narrowed to permit an
    on-device capture queue for images, with no offline expense writes
  - Development Standards → Out of Scope for V1: "Mixed currency within a single project" removed
Templates requiring updates: none — `.specify/templates/*` contain only generic, project-agnostic
  boilerplate (e.g. illustrative "mobile-app" project types and path conventions for hypothetical
  future specs); none describe this repository's now-retired mobile package.
Deferred TODOs: none
-->

# Expense Tracker Constitution

## Core Principles

### I. API-First, Stateless Backend

The backend MUST expose all functionality via REST endpoints. The frontend is a consumer only — it MUST NOT contain business logic, financial calculations, or data transformation beyond display formatting. All state lives server-side. The backend MUST be stateless: no session state stored in memory between requests. Authentication state is carried entirely in JWT tokens.

### II. Self-Hosted, Docker-Native Deployment

All services MUST run via `docker-compose`. There are no managed cloud infrastructure dependencies in V1 except:
- OpenAI API (receipt parsing)
- Email delivery provider (Resend or Postmark)

Every other service — PostgreSQL, MinIO, the API server, the web frontend — MUST be defined as a `docker-compose` service. Local development and production deployment use the same `docker-compose` configuration (with environment variable overrides).

### III. Financial Accuracy (NON-NEGOTIABLE)

All monetary values MUST be stored and computed as integers in the smallest currency unit (Norwegian øre: 1 kr = 100 øre). Floating-point arithmetic is FORBIDDEN for any monetary calculation. Currency amounts are converted to integers on input and formatted for display on output only. Amounts in any other currency MUST be stored as integers in that currency's own minor unit and converted to home-currency øre via a scaled-integer rate; floating-point conversion is equally forbidden. Settlement calculations MUST be deterministic: given the same set of confirmed expenses and an allocation key, the result is always identical.

### IV. Mobile-First UI

The web app is the phone client: a responsive Progressive Web App designed for mobile viewport first (≥320px) and installable to the home screen. Desktop layout is an enhancement, not the baseline. There is no separate native client and no shared package split between web and mobile business logic — the web app and its API client are the only frontend.

## Technology Stack

### Backend
- **Runtime:** Node.js 20 LTS
- **Framework:** Express 4
- **Language:** TypeScript 5
- **Database:** PostgreSQL 16 (self-hosted via Docker)
- **File storage:** MinIO (self-hosted, S3-compatible API)
- **Auth:** JWT (short-lived access tokens, refresh token rotation)
- **Password hashing:** bcrypt, minimum 12 rounds

### Frontend — Web
- **Framework:** React 18 + TypeScript 5
- **Build tool:** Vite
- **State management:** Zustand
- **Charts:** Recharts
- **Styling:** TailwindCSS

### AI Integration
- **Provider:** OpenAI API
- **Model:** `gpt-4o-mini` (multimodal)
- **Invocation:** Server-side only — receipt images MUST NOT be sent to OpenAI from the client
- **Output contract:** Structured JSON `{ store, date, items: [{ description, quantity, unitPrice }] }` with confidence flags

### Notifications
- **Email:** Resend or Postmark (invites, settlement ready, reminders)

### Deployment
- **Containerisation:** Docker + docker-compose
- **Environments:** Local dev and production use the same `docker-compose.yml` with `.env` overrides

### Forbidden Patterns
- Floating-point arithmetic for any monetary value
- Business logic or financial calculations in the frontend
- Client-side invocation of the OpenAI API
- Direct database access from the frontend
- Android support (V1)
- Vipps ePayment API (V1 uses deeplink display only; payment is manual)
- Offline expense entry (V1) — the on-device capture queue may hold captured receipt images while
  offline, but it MUST NOT create, edit, or otherwise write expenses, settlements, projects, or
  categories offline

## Development Standards

### Authentication
- Email/password login only (no OAuth, no social login)
- Invitation is the sole account-creation path — there is no public registration
- Passwords hashed with bcrypt ≥12 rounds
- JWT access tokens expire in 15 minutes; refresh tokens expire in 30 days with rotation
- All API endpoints MUST require a valid JWT except: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/accept-invite`, `GET /auth/invite-info`

### Data Integrity
- All financial values stored as integers (øre)
- Allocation keys stored as an array of percentages summing to exactly 100 (integer or two-decimal precision)
- Allocation keys are immutable once a settlement period has started
- Expenses have a status lifecycle: `pending_review → confirmed → settled`; transitions are one-directional

### Receipt Storage
- Receipt images stored in MinIO, never in the database
- Database stores only the MinIO object key
- Receipt images accessible via signed URLs with short expiry (e.g. 1 hour)

### Out of Scope for V1
- GDPR receipt image retention policies
- Offline expense entry with sync
- Android support
- Vipps ePayment API integration
- Bank/card automatic import
- Multi-household support per user
- Recurring expenses
- Budget alerts and predictions
- Personal expense tracking (hidden projects)

## Governance

This constitution supersedes all other project documentation for technology and principle decisions. Any implementation that contradicts a principle in this document is non-compliant and MUST be revised before merging.

**Amendment procedure:**
1. Proposed change documented with rationale
2. All dependent spec/plan/task documents reviewed for impact
3. Version incremented (MAJOR: principle removal or redefinition; MINOR: new principle or section; PATCH: clarification or wording)
4. `LAST_AMENDED_DATE` updated on ratification

All implementation work MUST be traceable to a task in `tasks.md`, which MUST be traceable to a requirement in `spec.md`, which MUST be consistent with this constitution.

**Version**: 2.0.0 | **Ratified**: 2026-03-29 | **Last Amended**: 2026-09-12
