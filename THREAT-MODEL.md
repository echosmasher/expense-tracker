# Threat Model

Self-hosted, single-tenant-per-instance household expense tracker handling auth credentials
and a financial ledger. This page names the trust boundaries and the threats that follow from
them, so an AI adversarial reviewer (and a human one) can spend effort on real exposure instead
of re-deriving the attack surface.

## Trust boundaries & data flow

```
                          TLS (Caddy/Let's Encrypt, or Cloudflare Tunnel)
  [User browser/iOS] ───────────────────────────────► [web: nginx]
        │  access JWT (Bearer, in memory)                   │ proxies /api
        │  refresh token (httpOnly, SameSite=Strict cookie) ▼
        │                                              [api: Express]  ◄── trust boundary: all
        │                                                   │              authn/authz lives here
        │  signed URL (1h) ────────────────────────────────┼──────────────► [MinIO] (S3)
        │                                                   ├──► [Postgres] (credentials, ledger)
        │                                                   ├──► [OpenAI] receipt images + text
        │                                                   └──► [Resend] invite/settlement emails
```

**Boundary 1 — Internet → web/api.** Untrusted input. TLS terminates at Caddy or Cloudflare.
CORS is locked to `WEB_ORIGIN`.
**Boundary 2 — api → Postgres/MinIO.** Trusted Docker network; not internet-exposed. The API is
the *only* component that authenticates or authorizes — nginx and the datastores enforce nothing.
**Boundary 3 — api → third parties (OpenAI, Resend).** Receipt images and member email addresses
leave the perimeter; secrets (API keys) must stay server-side.
**Boundary 4 — the household itself.** Members are semi-trusted: authorized to a household's data
but must be isolated from *other* households. This is the primary in-scope boundary and the one
most likely to break (it already did once — see history).

## Assets

Password hashes (bcrypt, cost 12) · refresh tokens (sha256-hashed at rest) · JWT signing secret ·
the expense/settlement ledger · receipt images · members' email addresses & card last-4 ·
third-party API keys.

## Threats (STRIDE-ish), with current mitigation

| # | Threat | Mitigation | Residual risk |
|---|--------|-----------|---------------|
| T1 | **Cross-household data access** (IDOR) | All queries scoped by `household_id`/`project_id`; 39 negative tests in CI | New routes can reintroduce it — every new endpoint needs an isolation test |
| T2 | **Credential theft / brute force** | bcrypt-12, rate limit 20/15min, identical error for bad-password vs unknown-email | No account lockout or 2FA; limiter is in-memory (per-process, resets on restart, not shared across replicas) |
| T3 | **Session/token abuse** | 15-min access token; refresh rotates on use and old token is revoked (replay fails, tested); httpOnly + SameSite=Strict defeats CSRF & JS theft | Access token not revocable within its 15-min window; no refresh-reuse *detection* (rotation only) |
| T4 | **Money tampering** | Integer-øre only (floats → 400), basis-point shares sum-checked, `purchasedBy` membership-validated, settlement calc unit + would-be property tested | Settlement calc lacks property-based tests (audit item, not yet done) |
| T5 | **Malicious upload** | multer 2.x, 10 MB cap, MIME allow-list, memory storage; images keyed under `receipts/:householdId/` | No content re-validation/transcoding; MIME is client-asserted; image bytes are sent to OpenAI |
| T6 | **Injection** | Exclusively parameterized `pg` queries; dynamic statistics filters use positional params, never interpolation; CSV export quotes fields | SQL surface is clean today; CSV is not formula-escaped (spreadsheet formula injection if opened in Excel) |
| T7 | **Secret exposure** | Secrets in `.env` (gitignored), validated at boot, rejected if placeholder; logger redacts `password`/`token`/`authorization` | Secrets are plaintext on the host; no rotation procedure; receipt data egresses to OpenAI |
| T8 | **Invite abuse** | Tokens are random 32-byte, sha256-hashed, 7-day expiry, single-use, bound to the invited email | A leaked unexpired token is usable by anyone until it's accepted (then closed) |
| T9 | **Supply chain** | `npm ci` from committed lockfile; `npm audit --omit=dev` gates backend/shared/web in CI | Expo/RN toolchain in `mobile/` carries unpatched advisories (needs SDK upgrade); no SBOM/pinned digests |
| T10 | **DoS** | Per-IP rate limits on auth and receipt-parse; 1 MB JSON body cap | No global request quota; a valid member can issue unbounded normal API calls |

## Out of scope

Multi-tenant isolation between *instances* (each deployment is one or a few trusted households);
host/OS hardening; physical access to the server; malicious household admin acting within their
own household; nation-state adversaries.

## Highest-value next hardening (beyond the current top-5)

- **T2/T3**: move the rate limiter to a shared store and add refresh-reuse *detection* (a revoked
  token being presented signals theft → revoke the whole chain).
- **T6**: prefix CSV cells starting with `= + - @` to neutralize spreadsheet formula injection.
- **T4**: property-based tests on `calculateSettlement` (sum preservation, remainder-to-admin).
