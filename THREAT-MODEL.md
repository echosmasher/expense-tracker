# Threat Model

Self-hosted, single-tenant-per-instance household expense tracker handling auth credentials
and a financial ledger. This page names the trust boundaries and the threats that follow from
them, so an AI adversarial reviewer (and a human one) can spend effort on real exposure instead
of re-deriving the attack surface.

## Trust boundaries & data flow

```
  [User browser/iOS] ──TLS──► [Cloudflare edge] ──outbound tunnel──► [cloudflared] ──► [web: nginx]
        │  access JWT (Bearer, in memory)                                                    │ proxies /api,
        │  refresh token (httpOnly, SameSite=Strict cookie)                                  │ sets CSP/HSTS/
        │  session restored silently on load (spec 004)                                      │ referrer/perms
        │  image bytes via an authenticated API route,                                       ▼   headers
        │  no signed URL, access checked every request,                              [api: Express]  ◄── trust
        │  doesn't expire ─────────────────────────────────────────────────────────────────┤     boundary: all
        │                                                                                    │     authn/authz
        │                                                                                    ├──► [MinIO] (S3,
        │                                                                                    │     no public
        │                                                                                    │     endpoint)
        │                                                                                    ├──► [Postgres] (credentials, ledger)
        │                                                                                    ├──► [OpenAI] receipt images + text
        │                                                                                    └──► [Resend] invite/settlement emails
```

**Boundary 1 — Internet → Cloudflare → tunnel → nginx.** Untrusted input. TLS terminates at
Cloudflare's edge; `cloudflared` makes an outbound-only connection from the host, so nothing on
the host listens on a public port. There is no LAN-only fallback anymore — the app is reachable
from anywhere by design (spec 004, US5); the perimeter that mattered when this was LAN-only
(a stranger has to be on the network at all) is gone, so account creation being invite-only
(T11) is now load-bearing rather than defense-in-depth. CORS is locked to `WEB_ORIGIN`. nginx
forwards the real client address (`CF-Connecting-IP`, set by Cloudflare's edge) as `X-Forwarded-For`
so the API's per-IP rate limits (T2, T10) key on the actual client, not the tunnel or nginx.
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
| T3 | **Session/token abuse** | 15-min access token; refresh rotates on use and old token is revoked; **reuse detection**: replaying a rotated token revokes the whole token family (tested); httpOnly + SameSite=Strict defeats CSRF & JS theft; session is now restored silently on app load via the refresh cookie (spec 004) — reuse detection and rotation are unchanged, restore is just another `/auth/refresh` call | Access token not revocable within its 15-min window |
| T4 | **Money tampering** | Integer-øre only (floats → 400), basis-point shares sum-checked, `purchasedBy` membership-validated; settlement calc covered by example **and property-based tests** (sum-to-zero, integer-only, remainder-to-admin, ≤N−1 transactions) | Low — financial core is now well-pinned |
| T5 | **Malicious upload** | multer 2.x, 10 MB cap, MIME allow-list, memory storage; images keyed under `receipts/:householdId/`; **every upload re-encoded server-side via sharp — validates it's a real image, strips all metadata incl. GPS EXIF, caps dimensions** (tested); the on-device downscale added for mobile capture (spec 004) is a bandwidth optimization only and does not replace this server-side re-encode — a captured image still goes through the same sanitization before storage | Re-encoded bytes still sent to OpenAI for receipts (inherent to the feature) |
| T6 | **Injection** | Exclusively parameterized `pg` queries; dynamic statistics filters use positional params, never interpolation; CSV export quotes fields **and prefixes formula-trigger cells (`= + - @`) with `'`** (tested) | SQL surface is clean today |
| T7 | **Secret exposure** | Secrets in `.env` (gitignored), validated at boot, rejected if placeholder; logger redacts `password`/`token`/`authorization`; **documented rotation runbook with blast-radius per secret** (DEPLOYMENT.md) | Secrets still plaintext on the host (acceptable for a single trusted host); receipt data egresses to OpenAI |
| T8 | **Invite abuse** | Tokens are random 32-byte, sha256-hashed, 7-day expiry, single-use, bound to the invited email | A leaked unexpired token is usable by anyone until it's accepted (then closed) |
| T9 | **Supply chain** | `npm ci` from committed lockfile; `npm audit --omit=dev` gates every workspace in CI | No SBOM/pinned digests |
| T10 | **DoS** | Per-IP rate limits on auth and receipt-parse; 1 MB JSON body cap | No global request quota; a valid member can issue unbounded normal API calls |
| T11 | **Public account creation** — a stranger reaching the public hostname signs up and spends the household's OpenAI credit or pollutes the ledger | There is no registration route or page; accounts are created only via `accept-invite` (email-bound, single-use, expiring token) or the `create-user` CLI run on the host (`docker compose exec api node dist/cli/create-user.js`), never over the network | An admin who issues an invite to the wrong address hands that address account creation; invites still expire in 7 days and are single-use |
| T12 | **On-device capture storage** — the offline capture queue (spec 004) holds photographed receipt images on the phone until they upload | Images live in browser storage (IndexedDB) unencrypted, scoped to the app's own origin, and are deleted once a flush succeeds; a failed flush is retained so the image isn't lost, not to widen exposure | Accepted: unencrypted at rest on the device, same as any other browser-storage web app. Anyone with access to the phone/browser profile could read a queued image before it flushes. Out of scope for V1 — no biometric app lock or per-device session management |

## Out of scope

Multi-tenant isolation between *instances* (each deployment is one or a few trusted households);
host/OS hardening; physical access to the server; malicious household admin acting within their
own household; nation-state adversaries.

## Next hardening

Done since the top-5: **T3** refresh-reuse detection, **T4** property-based settlement
tests, **T6** CSV formula-injection escaping, **T5** server-side image re-encode + metadata
strip, **T7** secret-rotation runbook.

Remaining — each deliberately deferred, not forgotten:
- **T2**: a shared-store rate limiter / account lockout needs Redis or a DB-backed counter.
  The in-memory per-process limiter is adequate for a single-instance deployment, and account
  lockout introduces its own DoS vector (an attacker can lock out a victim by failing their
  logins). Revisit only if the API is ever run multi-replica.
- **T7 (secrets manager)**: moving secrets off plaintext `.env` to Vault/Doppler/KMS is only
  worth the operational weight beyond a single trusted host. The rotation runbook covers the
  realistic risk for this deployment.
- **T9 (mobile toolchain)**: resolved. The Expo/React Native package that carried the
  remaining unpatched advisories has been removed (`mobile/` is deleted); `npm audit --omit=dev`
  is now clean and enforced across every workspace.
