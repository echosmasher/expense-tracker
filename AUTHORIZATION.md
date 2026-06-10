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
| `POST /auth/register`, `/auth/login` | ✓ (rate-limited 20/15min) ✓test | — | — | — | — |
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
| Settlements: list, read | ✗ | ✗ | ✗ | ✓ scoped ✓test | ✓ |
| Settlements: trigger (`POST`) | ✗ | ✗ | ✗ | ✗ ✓test | ✓, max one open per household |
| Mark settlement transaction paid | ✗ | ✗ | only the debtor, the creditor, or the household admin; only while settlement is open ✓test | | |
| Projects: create in household | ✗ | ✗ | ✓; `memberIds` must all be household members, else 400 `INVALID_MEMBERS` ✓test | ✓ | ✓ |
| Projects: read, list/add expenses | ✗ | ✗ project member only ✓test | | | |
| — project expense `purchasedBy` | must be a project member, else 400 `INVALID_PURCHASER` ✓test | | | | |
| Projects: finish (trigger settlement) | ✗ | ✗ | project **admin** only ✓test | | |
| Statistics (overview, drill-down, CSV export) | ✗ | ✗ | ✗ | ✓ scoped ✓test | ✓ |
| Categories: list | ✗ | ✗ | ✓ ✓test | ✓ | ✓ |
| Categories: rename / delete | ✗ | ✗ | ✗ ✓test | ✗ | ✓; system categories immutable (400) |
| `POST /receipts/parse?householdId=` | ✗ | ✗ membership checked **before** upload/AI call ✓test | ✓ | ✓ | ✓ |

## Invariants worth stating explicitly

1. **No cross-household path exists for any verb.** A member of household B gets 403 on
   household A URLs and 404 when stuffing household-A resource IDs into household-B URLs.
2. **Money attribution is closed under membership**: an expense or project expense can only
   credit a user inside the same household/project, so settlement balances cannot reference
   outsiders.
3. **Invite tokens are bearer credentials but email-bound**: acceptance creates/joins the
   account for `invite.email` only — a forwarded link cannot join an attacker's own address.
4. **Allocation keys must sum to exactly 10,000 bp** at creation and update.
5. The only unauthenticated mutating endpoints are `register` and `accept-invite`,
   both rate-limited.
