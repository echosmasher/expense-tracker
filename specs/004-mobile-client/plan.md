# Implementation Plan: Mobile Client (iOS PWA)

**Branch**: `004-mobile-client` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

## Summary

Make the existing React web app the phone client. No native shell. The work is: delete the Expo
package; amend the constitution; restore sessions on load; move image delivery behind the API;
remove public registration and add a host-side bootstrap command; give the app a phone layout and
make it installable with a service worker; add a single server endpoint that turns an uploaded
receipt into an editable draft expense; put every capture through an IndexedDB queue that flushes
that endpoint idempotently; and publish the stack through a Cloudflare Tunnel with security headers
set in nginx.

Tasks for this spec live as GitHub issues (label `spec:004-mobile-client`) rather than a
`tasks.md`; the ticket map at the end of this plan is the authoritative order.

## Constitution Check

Checked against constitution 1.0.0, with the amendment this spec carries (Ticket 2) noted.

| Principle | Status | Notes |
|---|---|---|
| I. API-First, Stateless Backend | PASS | Draft creation, editing, and image delivery are API routes. The queue holds images, not business state. |
| II. Self-Hosted, Docker-Native | PASS | `cloudflared` is one more compose service; Cloudflare terminates TLS but holds no data. |
| III. Financial Accuracy | PASS | No monetary logic changes. Draft totals are recomputed server-side on every line change. |
| IV. Mobile-First UI | AMEND | The React Native clause is dropped; the web client is the phone client. |
| V. Realtime Shared State | AMEND | Never implemented; the clause is removed rather than left as a false claim. |
| Auth: `register` is an allowed unauthenticated route | AMEND | `register` is removed; `accept-invite` remains. |
| Forbidden: offline expense entry | AMEND | Narrowed: the capture queue is the only offline write, and it holds images, not expenses. |
| AI provider: Anthropic | AMEND | Code has used OpenAI `gpt-4o-mini` since 001; the constitution is corrected. |

---

## Data Model Changes

### `expenses`

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `capture_id` | UUID | NULL, `UNIQUE (household_id, capture_id)` and `UNIQUE (project_id, capture_id)` | Client-generated identity of the capture that created this draft. Makes draft creation idempotent per capture. |

`status = 'pending_review'` may now have zero line items. The confirm route rejects a zero-item
draft with `409 EMPTY_EXPENSE`. Confirmed and settled expenses still require at least one item.

### `line_items`

No schema change. `total_price_ore` is still not authoritative in this spec (spec 005 makes it so).

### Migration `009_expense_capture_id.sql`

Additive: one nullable column, two partial unique indexes. No backfill.

---

## Backend Changes

### Receipt intake service — `backend/src/services/receiptIntake.ts`

The pipeline currently inlined in `POST /receipts/parse` (sanitise → upload → parse → card match →
categorise) moves into one service function so the household route, the project route, and tests
share it. `POST /receipts/parse` is removed once the draft endpoints exist; the shared API client's
`receipts.parse` goes with it.

### Draft creation

- `POST /households/:householdId/expenses/from-receipt` — multipart `receipt`, form field
  `captureId` (UUID, required). Active member only.
- `POST /projects/:projectId/expenses/from-receipt` — same, project member only.

Behaviour: run intake, then in one transaction insert the expense (`pending_review`,
`purchased_by` = caller, `capture_id`, parsed store/date/card, zero or more line items with
categories). If an expense with this `capture_id` already exists in that scope, return it with
`200` instead of creating another (`201` on first creation). Rate-limited like parse is today.

Response: the full expense (existing `getFullExpense` shape) with `receiptImageUrl` now an API
path (see images).

### Draft editing

All routes require the expense to be `pending_review`; otherwise `409 INVALID_STATUS`. Every
mutation recomputes `total_amount_ore` server-side (non-personal lines only).

- `PATCH /households/:householdId/expenses/:expenseId` — `store`, `date`, `purchasedBy`,
  `cardLastFour`. `purchasedBy` must be a member (existing `INVALID_PURCHASER` rule).
- `POST /households/:householdId/expenses/:expenseId/line-items` — one line item (same schema as
  create).
- `DELETE /households/:householdId/expenses/:expenseId/line-items/:lineItemId`.
- Existing `PATCH .../line-items/:lineItemId` gains `isPersonal` and `categoryId`.
- Project equivalents under `/projects/:projectId/expenses/:expenseId/...` with project-member
  checks.
- `POST .../confirm` rejects zero line items.

### Images through the API

- `GET /households/:householdId/expenses/:expenseId/receipt` — active member; streams the object
  from MinIO with its content type, `Cache-Control: private, no-store`. 404 if the expense has no
  receipt or belongs elsewhere.
- `GET /projects/:projectId/expenses/:expenseId/receipt` — project member.
- `GET /users/me/avatar` — owner only.

`getReceiptUrl`, the `s3Public` client, `MINIO_PUBLIC_ENDPOINT`, and `MINIO_PUBLIC_PORT` are
deleted. `receiptImageUrl` / `avatarUrl` fields now carry the API path. The `storage` service in
`docker-compose.yml` publishes no ports; the dev override keeps its local port mapping for the
console.

### Registration removal and bootstrap

- `POST /auth/register` deleted. `auth-lifecycle.test.ts` asserts 404.
- `backend/src/cli/create-user.ts` — `npm run create-user -- --email x --name y`; prompts for the
  password on stdin (never an argument); refuses if the email exists. Run as
  `docker compose exec api node dist/cli/create-user.js ...`. Built into the production image.
- `AUTHORIZATION.md`: drop the register row; add rows for from-receipt, draft edits, images;
  invariant 5 becomes "the only unauthenticated mutating endpoint is `accept-invite`".

### Session

No server change. The refresh cookie stays `httpOnly; SameSite=Strict; Secure; Path=/api/v1/auth`.

### Trust proxy and client IP

Cloudflare Tunnel → nginx → api. nginx sets `X-Real-IP` and `X-Forwarded-For` from
`CF-Connecting-IP` when present. `app.set('trust proxy', 1)` stays correct because nginx is the
single hop the API sees.

---

## Shared Package Changes

- `apiBaseUrl` configurable (`VITE_API_URL`, default same-origin `/api/v1`); `refreshToken()` uses
  it too.
- `expenses.createFromReceipt(householdId, file, captureId)`, `projects.createExpenseFromReceipt`,
  `expenses.update`, `expenses.addLineItem`, `expenses.deleteLineItem`; `receipts.parse` removed.
- `fetchImage(path): Promise<Blob>` — authenticated fetch for `<img>` sources.
- Remove the "shared by web and mobile" comment.

---

## Web Changes

### Session restore (`web/src/stores/authStore.ts`, `App.tsx`)

On boot: `POST /auth/refresh` → on success `GET /users/me` → `setUser`. A `SessionGate` renders a
neutral splash until the outcome is known, then either the app or `/login` with the intended
location preserved in router state.

### Phone layout (`AppShell.tsx`, new `BottomTabBar.tsx`, `pages/More.tsx`)

- Breakpoint: `< 768px` → bottom tab bar; `≥ 768px` → existing sidebar. One `useMediaQuery` hook.
- Tabs: Expenses, Settlement, **Scan** (raised centre button), Projects, More.
- `More`: Statistics, Household, Categories, Profile, Register Household, Log out, Capture queue.
- `viewport-fit=cover`; tab bar padded by `env(safe-area-inset-bottom)`; page content padded so
  nothing sits under the bar.
- All inputs ≥ 16px font size on phones (Safari zooms on smaller). Audit every page at 390px.

### Installable PWA (`vite-plugin-pwa`)

- Manifest: name, short name, `display: standalone`, theme/background colours, 192/512 icons,
  maskable icon, `apple-touch-icon` 180. `apple-mobile-web-app-*` meta tags.
- Workbox: precache build output; navigation fallback to `index.html`; runtime rule `/api/**` →
  `NetworkOnly`; `registerType: 'autoUpdate'` with `skipWaiting` + `clientsClaim`.
- Offline state: an `OfflineBanner` driven by `navigator.onLine` and `online`/`offline` events;
  pages that fail to load data while offline show the banner instead of an error.
- Fonts: copy Instrument Serif, DM Mono, Geist as woff2 into `web/public/fonts` with `@font-face`
  in `index.css`; remove the Google Fonts links.

### Scan (`web/src/capture/`)

- `CaptureInput`: `<input type="file" accept="image/*" capture="environment">` on phones, plain
  file input elsewhere. iOS converts HEIC on file inputs; regardless, the output below is JPEG.
- `downscale(file): Promise<Blob>`: `createImageBitmap` → canvas, longest edge 1600px, JPEG
  quality 0.8. Typical output 200–500 KB. Falls back to the original blob if decoding fails.
- `captureQueue.ts`: IndexedDB (`idb`) store `captures`:
  `{ id, blob, target: { householdId } | { projectId }, capturedAt, status: 'queued' | 'uploading' | 'failed', attempts, lastError, expenseId? }`.
  Flush triggers: enqueue, app boot after session restore, `online`, `visibilitychange` →
  visible, manual retry. Serial; one in flight. Network errors and 5xx → back to `queued` with
  exponential backoff; 4xx → `failed` with the server message. Success → delete the record and, if
  the user is still on the scan screen for this capture, navigate to the draft.
  `QuotaExceededError` on enqueue → surface "Storage full, capture not saved" and do not touch
  existing items.
- `ScanTab` badge shows the queued + failed count. `pages/CaptureQueue.tsx` lists items with
  thumbnail, target, age, status, retry / discard.
- The queue state machine is a pure reducer, unit-tested with `vitest` + `fake-indexeddb`. The web
  workspace gets a `test` script and CI runs it.

### Draft review (`pages/Expenses/ReviewDraft.tsx`)

Route `/expenses/:expenseId/review` (and `/projects/:projectId/expenses/:expenseId/review`).
Loads the draft, edits through the new endpoints (debounced per field, immediate per line item),
shows the receipt via `fetchImage`, confirms with the existing confirm route. `AddExpense` keeps
the manual, no-receipt path and loses its upload box; its line-item editor is extracted and reused.

### Images

`AuthImage` component: fetches via `fetchImage`, holds an object URL, revokes on unmount. Used in
expense detail, draft review, and profile settings.

### Register page

`Register.tsx`, its route, and the login-page link are deleted.

---

## Deployment Changes

### `docker-compose.yml`

- `storage`: remove `ports`.
- `api`: remove `MINIO_PUBLIC_ENDPOINT`.
- `cloudflared`: `image: cloudflare/cloudflared:<pinned>`, `command: tunnel run`,
  `TUNNEL_TOKEN` from `.env`, `depends_on: web`. The tunnel's public hostname routes to
  `http://web:80`.
- `web`: keep `ports` for LAN access; document that it may be dropped.

### `web/nginx.conf`

```
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
add_header Permissions-Policy "camera=(self), geolocation=(), microphone=()" always;
```

`style-src 'unsafe-inline'` is a stated trade-off: every component injects a `<style>` block.
Scripts stay strict. Removing the inline styles is a separate refactor, out of scope.

`proxy_set_header X-Real-IP $http_cf_connecting_ip` (fallback `$remote_addr`) for `/api/`.

### `DEPLOYMENT.md`

Rewritten around the tunnel path: DNS, `cloudflared tunnel create`, token into `.env`, first
account via `create-user`, verification checklist (port check on 9000, header check with `curl
-I`, CSP console check). The Caddy/port-forward option is dropped from the supported paths.

### `THREAT-MODEL.md`

Boundary 1 becomes "Internet → Cloudflare → tunnel → nginx". Signed URLs leave the diagram. New
rows: T11 public account creation (mitigated: route removed, invite only, bootstrap on host);
T12 client-side capture storage (images at rest on the device, unencrypted; accepted). T3 gains
"session restored silently on load; reuse detection unchanged". T5 notes the on-device downscale
does not replace server-side sanitisation. T9 residual risk cleared once `mobile/` is gone.

---

## Test Plan

- **Backend (`household-isolation.test.ts`)**: from-receipt, draft PATCH/POST/DELETE, receipt
  image, avatar — foreign-household 403/404, unauthenticated 401. From-receipt with a replayed
  `captureId` returns the same expense (SC-009). Confirm on zero-item draft → 409.
- **Backend (`auth-lifecycle.test.ts`)**: `POST /auth/register` → 404; refresh/rotation/reuse
  tests unchanged and green.
- **Backend (new `receipt-intake.test.ts`)**: parser stubbed to fail → draft created with zero
  items and the image key set.
- **Web (new, vitest)**: queue reducer transitions; flush with a failing then succeeding network
  stub leaves one draft; `QuotaExceededError` preserves existing items; downscale output is JPEG
  and within bounds (jsdom canvas stub, or skipped where unavailable and covered manually).
- **Manual on device (recorded in the ticket)**: SC-001, SC-002, SC-003, SC-007, SC-008.
- **CI**: web tests added; audit enforced across all workspaces.

## Rollout

Single-tenant; one migration; one compose change. Order matters for safety: images-through-API
and registration removal land before the tunnel is turned on. Existing sessions are unaffected —
the refresh cookie format does not change.

---

## Ticket Map

Numbers are implementation order. Edges are the only genuine blockers.

| # | Ticket | Blocked by | Delivers |
|---|---|---|---|
| 1 | Retire the Expo mobile package | — | Workspace, CI, Dockerfiles, docs without `mobile/`; audit enforced everywhere |
| 2 | Amend the constitution to 2.0.0 | — | Constitution matches the codebase and specs 004/005 |
| 3 | Restore the session on app load | — | Reload or relaunch resumes a signed-in session; login only when needed |
| 4 | Serve receipt and avatar images through the API | — | Images render via authenticated routes; MinIO unpublished; signed URLs gone |
| 5 | Invite-only accounts with host-side bootstrap | — | No register route or page; `create-user` command; matrix and threat model updated |
| 6 | Phone layout with bottom tab bar | — | Every screen usable at 390pt; sidebar unchanged on desktop |
| 7 | Installable PWA with offline shell | 3, 6 | Home-screen install, self-hosted fonts, service worker, offline state, auto-update |
| 8 | Draft expense from an uploaded receipt | 4 | One call creates an editable draft; review screen edits it; confirm |
| 9 | Scan with the camera and downscale on device | 6, 8 | Scan tab opens the camera, uploads a small JPEG, lands on the draft |
| 10 | Capture queue with offline flush | 9 | Every capture queued, flushed idempotently, visible count, failed state, retry |
| 11 | Public deployment via Cloudflare Tunnel with security headers | 4, 5, 7 | HTTPS public hostname, CSP and headers verified, docs rewritten |
