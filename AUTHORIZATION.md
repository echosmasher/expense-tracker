# Authorization Matrix

Who may do what, by role. This is the **intended** access-control model; deviations are bugs.
Every rule marked ✓test is pinned by an executable test in `backend/test/household-isolation.test.ts`
or `backend/test/auth-lifecycle.test.ts` — CI fails if it regresses.

## Roles

| Role | Definition |
|------|------------|
| Anonymous | No access token |
| User | Valid 15-min access JWT (`requireAuth`) |
| Member | User with a row in `household_members` for the household |
| Active member | Member of a household with `status = 'active'` (≥2 members) |
| Admin | Member with `role = 'admin'` (the household creator) |
| Project member / Project admin | Same pattern via `project_members` |
| Transaction party | The debtor or creditor of a settlement transaction |

Enforcement is deny-by-default: per-route helpers (`requireAuth`, `requireMember`,
`requireActiveMember`, `requireAdmin`, `requireProjectMember`, `requireProjectAdmin`) return
403; resource lookups are always scoped by `household_id`/`project_id` so foreign IDs return
404 (ID stuffing). ✓test

## Matrix

| Resource / operation | Anonymous | User | Member | Active member | Admin |
|---|---|---|---|---|---|
| `POST /auth/login` | ✓ (rate-limited 20/15min) ✓test | — | — | — | — |
| `POST /auth/refresh`, `/auth/logout` | ✓ with valid refresh cookie ✓test | | | | |
| `GET /auth/invite-info`, `POST /auth/accept-invite` | ✓ with unexpired, unused invite token ✓test | | | | |
| `GET/PATCH /users/me`, preferences, avatar | ✗ | ✓ self only | | | |
| `POST /users/me/password`, `DELETE /users/me` | ✗ | ✓ self, requires current password ✓test | | | |
| Cards (`POST`, `DELETE /users/me/cards/:id`) | ✗ | ✓ own cards only ✓test | | | |
| `POST /households` (creator becomes admin) | ✗ | ✓ | | | |
| `GET /households` (list) | ✗ | ✓ own memberships only ✓test | | | |
| `GET /households/:id` | ✗ | ✗ ✓test | ✓ | ✓ | ✓ |
| `PATCH /households/:id` (name, keywords, allocation key) | ✗ | ✗ | ✗ | ✗ | ✓ ✓test |
| `POST /households/:id/invites` | ✗ | ✗ | ✗ ✓test | ✗ | ✓; invitee must not already be a member ✓test |
| Expenses: list, read, create, confirm, edit line items | ✗ ✓test | ✗ | ✗ | ✓ household-scoped ✓test | ✓ |
| — `purchasedBy` on create | must be a member of the same household, else 400 `INVALID_PURCHASER` ✓test | | | | |
| — confirm on a zero-line-item draft | rejected: 409 `EMPTY_EXPENSE` ✓test | | | | |
| `POST /households/:id/expenses/from-receipt` | ✗ ✓test | ✗ | ✗ | ✓ household-scoped, rate-limited ✓test | ✓ |
| — replay of the same `captureId` | returns the existing draft (200), creates nothing else ✓test | | | | |
| `PATCH /households/:id/expenses/:id`, line-item add/delete | ✗ ✓test | ✗ | ✗ | ✓ household-scoped; draft (`pending_review`) only, else 409 `INVALID_STATUS` ✓test | ✓ |
| `PATCH .../line-items/:id` (price, qty, description, personal flag, category) | not status-gated — also used to correct an already-confirmed expense | | | | |
| `PATCH /households/:id/expenses/:id/rate` (correct a foreign expense's rate) | ✗ ✓test | ✗ | ✗ | ✓ household-scoped ✓test; foreign currency only (400 `NOT_FOREIGN_CURRENCY`); refused once settled (409 `EXPENSE_SETTLED`) or in an open settlement (409 `IN_OPEN_SETTLEMENT`, names the settlement) ✓test | ✓ |
| Settlements: list, read | ✗ | ✗ | ✗ | ✓ scoped ✓test | ✓ |
| Settlements: trigger (`POST`) | ✗ | ✗ | ✗ | ✗ ✓test | ✓, max one open per household |
| Mark settlement transaction paid | ✗ | ✗ | only the debtor, the creditor, or the household admin; only while settlement is open ✓test | | |
| Projects: create in household | ✗ | ✗ | ✓; `memberIds` must all be household members, else 400 `INVALID_MEMBERS` ✓test | ✓ | ✓ |
| Projects: read, list/add/read-one expenses | ✗ | ✗ project member only ✓test | | | |
| — project expense `purchasedBy` | must be a project member, else 400 `INVALID_PURCHASER` ✓test | | | | |
| `POST /projects/:id/expenses/from-receipt` | ✗ | ✗ project member only ✓test, rate-limited | | | |
| — replay of the same `captureId` | returns the existing draft (200), creates nothing else | | | | |
| `PATCH /projects/:id/expenses/:id`, line-item add/edit/delete, confirm | ✗ | ✗ project member only ✓test; draft (`pending_review`) only, else 409 `INVALID_STATUS` | | | |
| `PATCH /projects/:id/expenses/:id/rate` (correct a foreign expense's rate) | ✗ | ✗ project member only ✓test; foreign currency only (400 `NOT_FOREIGN_CURRENCY`); refused once settled (409 `EXPENSE_SETTLED`) or in an open settlement (409 `IN_OPEN_SETTLEMENT`) | | | |
| — confirm on a zero-line-item project draft | rejected: 409 `EMPTY_EXPENSE` | | | | |
| Projects: finish (trigger settlement) | ✗ | ✗ | project **admin** only ✓test | | |
| Statistics (overview, drill-down, CSV export) | ✗ | ✗ | ✗ | ✓ scoped ✓test | ✓ |
| Categories: list | ✗ | ✗ | ✓ ✓test | ✓ | ✓ |
| Categories: rename / delete | ✗ | ✗ | ✗ ✓test | ✗ | ✓; system categories immutable (400) |
| `GET /households/:id/expenses/:id/receipt` | ✗ ✓test | ✗ | ✗ ✓test | ✓ household-scoped ✓test; 404 if the expense has no receipt | ✓ |
| `GET /projects/:id/expenses/:id/receipt` | ✗ ✓test | ✗ project member only ✓test; 404 if the expense has no receipt | | | |
| `GET /users/me/avatar` | ✗ ✓test | ✓ self only ✓test; 404 if no avatar set | | | |

## Invariants worth stating explicitly

1. **No cross-household path exists for any verb.** A member of household B gets 403 on
   household A URLs and 404 when stuffing household-A resource IDs into household-B URLs.
2. **Money attribution is closed under membership**: an expense or project expense can only
   credit a user inside the same household/project, so settlement balances cannot reference
   outsiders.
3. **Invite tokens are bearer credentials but email-bound**: acceptance creates/joins the
   account for `invite.email` only — a forwarded link cannot join an attacker's own address.
4. **Allocation keys must sum to exactly 10,000 bp** at creation and update.
5. The only unauthenticated mutating endpoint is `accept-invite`, which is rate-limited.
   Accounts otherwise exist only by invitation or by the host-side `create-user` command
   (`backend/src/cli/create-user.ts`) — there is no public registration route.
6. **Image access does not expire.** Receipt and avatar bytes are streamed through the API
   under the same authorization check as the resource they belong to — there is no bearer
   URL that outlives the session that fetched it. Every image response carries
   `Cache-Control: private, no-store` so a shared cache or proxy cannot serve one user's
   image to another.
7. **There is no LAN perimeter to rely on.** The deployment is reachable from anywhere via a
   Cloudflare Tunnel (spec 004, ticket 11; see `THREAT-MODEL.md` boundary 1) — being on the
   home network is no longer a precondition for reaching any route. Every invariant above must
   hold against an internet-wide caller, not just a trusted-network one, and rule 5 (no public
   registration route) is what actually keeps a stranger who reaches the public hostname from
   creating an account, not network placement.
