# Research: Expense Tracker App

**Branch**: `001-expense-tracker-app` | **Date**: 2026-03-29

All technology choices were pre-decided before planning. This document records the rationale for each decision.

---

## Database Access Strategy

**Decision**: Plain SQL via `pg` driver with typed wrapper functions. No ORM.

**Rationale**: The data model is well-defined and stable. ORM magic is explicitly forbidden by the constitution. Hand-written SQL gives full control over query shape and avoids hidden N+1 queries. Typed wrappers (functions that accept typed inputs and return typed outputs) provide the safety benefit of ORMs without the magic.

**Alternatives considered**:
- Prisma — rejected (constitution forbids ORM magic; Prisma generates migration SQL that can be opaque)
- Drizzle — borderline acceptable but adds a dependency for no clear gain over typed SQL functions

---

## Realtime Strategy

**Decision**: WebSocket server (`ws` library) running alongside Express on the same HTTP server. Broadcasts to household-scoped rooms.

**Rationale**: Household-scale realtime (2–10 users) does not require a pub/sub infrastructure. A simple in-process WebSocket server is sufficient and eliminates external dependencies (no Redis, no Socket.io).

**Alternatives considered**:
- Server-Sent Events (SSE) — simpler but one-directional; ruled out because the mobile client (React Native) has better WebSocket support than SSE
- Socket.io — adds abstraction over ws with no benefit at this scale
- Supabase Realtime — rejected (constitution requires self-hosted; Supabase is external)

---

## Monorepo Structure

**Decision**: Four packages (`backend`, `web`, `mobile`, `shared`) in a single repository managed with npm workspaces.

**Rationale**: The `shared` package is the single authoritative location for financial calculation logic and the API client. Both web and mobile import from it, ensuring the settlement algorithm is never duplicated. npm workspaces is built into Node.js without additional tooling.

**Alternatives considered**:
- Turborepo — adds build caching but unnecessary complexity for this scale
- Separate repos — would require publishing `shared` as a package; too much overhead for a household-scale app

---

## File Storage

**Decision**: MinIO (self-hosted, S3-compatible), running as a docker-compose service.

**Rationale**: Receipt images must not be stored in the database. MinIO provides an S3-compatible API so the backend uses standard AWS SDK (`@aws-sdk/client-s3`) — swappable to real S3 later with an env var change. Signed URLs with short expiry (1 hour) ensure receipt images are not publicly accessible.

**Alternatives considered**:
- Supabase Storage — rejected (external cloud dependency; constitution requires self-hosted)
- Local filesystem volume — simpler but not production-safe and not S3-compatible

---

## AI Receipt Parsing

**Decision**: Anthropic API, `claude-sonnet-4-20250514` (multimodal), server-side only.

**Rationale**: Fixed by the constitution. Server-side invocation ensures the API key is never exposed to the client. The model supports multilingual receipt text (Norwegian, Swedish, English per FR-025).

**Prompt strategy**: Structured JSON output with a confidence field per item. System prompt instructs the model to return `{ store: string, date: string, items: [{ description: string, quantity: number, unitPrice: number, confidence: "high"|"low" }] }`. Low-confidence items are returned to the client flagged for manual review.

**Fallback**: If the Anthropic API call fails or times out (>30s), the backend returns an empty parse result. The client falls back to full manual entry with the stored receipt image still available for reference.

---

## Authentication

**Decision**: JWT (access + refresh token pair). Access tokens expire in 15 minutes; refresh tokens expire in 30 days with rotation. Stored in httpOnly cookies (web) and SecureStore (React Native/Expo).

**Rationale**: Simple email/password auth as specified. No third-party auth provider needed. httpOnly cookies prevent XSS token theft on web. Refresh token rotation invalidates stolen refresh tokens on reuse.

**Alternatives considered**:
- Supabase Auth — rejected (self-hosted requirement)
- Session-based auth — stateful; requires session store; rejected in favour of stateless JWT per constitution

---

## Email

**Decision**: Resend (external service).

**Rationale**: Lightweight, developer-friendly transactional email API. Three templates required: invite, settlement ready, reminder. Resend is not self-hostable but is the only constitutionally-permitted external dependency of this type (alongside Anthropic API and APNs).

**Alternatives considered**:
- Postmark — equally good; Resend chosen for simpler SDK
- SMTP + nodemailer — would require running an SMTP server in docker-compose; unnecessary complexity

---

## Monetary Representation

**Decision**: All monetary values stored as integers in øre (1 NOK = 100 øre). Allocation key shares stored as integers in basis points (10 000 bp = 100%).

**Rationale**: Required by constitution. Avoids floating-point rounding errors in settlement calculations. All arithmetic uses integer operations. Rounding remainder (from allocation key splits that don't divide evenly) is assigned to the household admin member.

**Display**: Formatting to "kr 249,90" is done in the frontend only, in display-layer utility functions.
