<!-- SYNC IMPACT REPORT
Version change: (none) → 1.0.0 (initial ratification)
Added sections: Core Principles, Technology Stack, Development Standards, Governance
Modified principles: N/A (initial)
Templates requiring updates: none pending
Deferred TODOs: none
-->

# Expense Tracker Constitution

## Core Principles

### I. API-First, Stateless Backend

The backend MUST expose all functionality via REST endpoints. The frontend is a consumer only — it MUST NOT contain business logic, financial calculations, or data transformation beyond display formatting. All state lives server-side. The backend MUST be stateless: no session state stored in memory between requests. Authentication state is carried entirely in JWT tokens.

### II. Self-Hosted, Docker-Native Deployment

All services MUST run via `docker-compose`. There are no managed cloud infrastructure dependencies in V1 except:
- Anthropic API (receipt parsing)
- Email delivery provider (Resend or Postmark)
- APNs (iOS push notifications)

Every other service — PostgreSQL, MinIO, the API server, the web frontend — MUST be defined as a `docker-compose` service. Local development and production deployment use the same `docker-compose` configuration (with environment variable overrides).

### III. Financial Accuracy (NON-NEGOTIABLE)

All monetary values MUST be stored and computed as integers in the smallest currency unit (Norwegian øre: 1 kr = 100 øre). Floating-point arithmetic is FORBIDDEN for any monetary calculation. Currency amounts are converted to integers on input and formatted for display on output only. Settlement calculations MUST be deterministic: given the same set of confirmed expenses and an allocation key, the result is always identical.

### IV. Mobile-First UI

The web frontend MUST be designed for mobile viewport first (≥320px). Desktop layout is an enhancement, not the baseline. The iOS app (React Native) MUST share all business logic (calculation utilities, API client, validation) with the web frontend via a shared package. Platform-specific code is limited to navigation, native UI components, and push notification handling.

### V. Realtime Shared State

Expense lists, balances, and settlement status MUST sync in realtime across all household members. When one member adds or confirms an expense, other members' views update without a manual refresh. Realtime is implemented via WebSockets (or Server-Sent Events). Personal expenses and personal projects are excluded from realtime sync — they are visible only to their owner.

## Technology Stack

### Backend
- **Runtime:** Node.js 20 LTS
- **Framework:** Express 4
- **Language:** TypeScript 5
- **Database:** PostgreSQL 16 (self-hosted via Docker)
- **File storage:** MinIO (self-hosted, S3-compatible API)
- **Auth:** JWT (short-lived access tokens, refresh token rotation)
- **Password hashing:** bcrypt, minimum 12 rounds
- **Realtime:** WebSocket server (ws library) or Server-Sent Events — decision in plan

### Frontend — Web
- **Framework:** React 18 + TypeScript 5
- **Build tool:** Vite
- **State management:** Zustand
- **Charts:** Recharts
- **Styling:** TailwindCSS

### Frontend — iOS
- **Framework:** React Native (Expo managed workflow)
- **Charts:** Victory Native
- **Push notifications:** Expo Notifications + APNs (V1: settlement alerts only)

### AI Integration
- **Provider:** Anthropic API
- **Model:** `claude-sonnet-4-20250514` (multimodal)
- **Invocation:** Server-side only — receipt images MUST NOT be sent to Anthropic from the client
- **Output contract:** Structured JSON `{ store, date, items: [{ description, quantity, unitPrice }] }` with confidence flags

### Notifications
- **Email:** Resend or Postmark (invites, settlement ready, reminders)
- **Push:** Expo Notifications + APNs

### Deployment
- **Containerisation:** Docker + docker-compose
- **Environments:** Local dev and production use the same `docker-compose.yml` with `.env` overrides

### Forbidden Patterns
- Floating-point arithmetic for any monetary value
- Business logic or financial calculations in the frontend
- Client-side invocation of the Anthropic API
- Direct database access from the frontend
- Android support (V1)
- Vipps ePayment API (V1 uses deeplink display only; payment is manual)
- Offline expense entry (V1)

## Development Standards

### Authentication
- Email/password login only (no OAuth, no social login)
- Passwords hashed with bcrypt ≥12 rounds
- JWT access tokens expire in 15 minutes; refresh tokens expire in 30 days with rotation
- All API endpoints MUST require a valid JWT except: `POST /auth/login`, `POST /auth/register`, `POST /auth/accept-invite`

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
- Mixed currency within a single project
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

**Version**: 1.0.0 | **Ratified**: 2026-03-29 | **Last Amended**: 2026-03-29
