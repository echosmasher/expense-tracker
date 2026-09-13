# Deployment

Operational checklist for hosting this app on a real machine reachable at a real domain. Reflects the state of the codebase as of 2026-09-13 (post-spec-004, ticket 11 — public deployment via Cloudflare Tunnel).

> There are older notes in `resources/deployment-guide.md` and `resources/server-deploy.md`. This file is the current one — start here.

## What you're deploying

Five Docker services come up together via `docker-compose.yml`:

| Service | Image | Purpose | Internal port |
|---|---|---|---|
| `db` | `postgres:16-alpine` | Application database | 5432 |
| `storage` | `minio:RELEASE.2025-09-07T16-13-09Z` | Receipt image storage (S3-compatible), internal-only | 9000 / 9001 console (neither published on the host, no publicly reachable endpoint) |
| `api` | built from `backend/Dockerfile` | Express server | 3001 |
| `web` | built from `web/Dockerfile` | nginx serving the React bundle, proxying `/api` to `api`, and setting security headers | 80 |
| `cloudflared` | `cloudflare/cloudflared:<pinned>` | Cloudflare Tunnel connector — the only path in from the internet | — (outbound-only) |

Persistent state lives in two Docker volumes: `postgres_data` and `minio_data`. Back both up.

The Cloudflare Tunnel is the **one supported path to the public internet**. There is no
port-forwarding/Caddy/nginx-proxy-manager option documented here anymore: it means open router
ports, your own TLS renewal, and (in the old design) a published MinIO console port. The tunnel
needs none of that — `cloudflared` makes an outbound-only connection to Cloudflare's edge, so
nothing on the host listens on a public port at all.

## Prerequisites

- A Linux host you control (laptop, NUC, mini-PC, VPS — anything that can keep Docker running).
- Docker Engine + Docker Compose v2 installed.
- A domain you control, added as a zone in Cloudflare (cloudflare.com — free tier is fine).
  Subdomain is fine, e.g. `tracker.yourdomain.no`.
- Accounts:
  - **Cloudflare** — Zero Trust tunnel + DNS + TLS termination.
  - **Resend** (resend.com) — transactional email for invites and settlement notifications.
  - **OpenAI** — used by `backend/src/services/receiptParser.ts` for receipt OCR (`gpt-4o-mini`). Free tier won't be enough long-term; budget a few dollars/month.

## Step 1 — Get the code on the host

```bash
git clone git@github.com:echosmasher/expense-tracker.git
cd expense-tracker
cp .env.example .env
```

Edit `.env` next — do not start anything yet.

## Step 2 — Create the Cloudflare Tunnel

1. Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** →
   choose **Cloudflared**, name it (e.g. `expense-tracker`).
2. On the "Install connector" step, copy the token from the `cloudflared tunnel run --token
   <...>` command shown — that token is the whole `TUNNEL_TOKEN` value, nothing to install on the
   host directly, the token goes in `.env` instead (Step 4) and the `cloudflared` compose service
   uses it.
3. Add a **Public Hostname**: subdomain `tracker` (or whatever you chose), domain
   `yourdomain.no`, service type `HTTP`, URL `web:80` — that's the Docker Compose service name and
   port, not `localhost`.
4. Save. Cloudflare creates the DNS record for you; no manual `A` record and no dynamic DNS setup
   — the tunnel is an outbound connection from `cloudflared`, so your public IP (and whether it
   changes) doesn't matter.
5. Cloudflare terminates TLS at its edge. The app itself stays plain HTTP inside the Docker
   network; you still set `APP_URL`/`WEB_ORIGIN` to the `https://` hostname (Step 4) because
   that's what a browser actually sees.

Do NOT serve plain HTTP to the public internet — refresh tokens are httpOnly cookies with
`SameSite=strict`; some browsers will silently reject them on insecure origins. This is moot with
the tunnel (Cloudflare always terminates as HTTPS to the browser) but matters if you ever bypass it.

## Step 3 — Verify the domain in Resend

Required for any invite or settlement email to actually deliver.

1. resend.com → Domains → Add Domain (e.g. `yourdomain.no`).
2. Copy the DKIM, SPF, and DMARC DNS records Resend shows.
3. Add them to the domain's DNS. DNS propagation can take an hour, sometimes longer.
4. Wait for the domain to show "Verified" in Resend.
5. Pick a sender address on that domain (e.g. `noreply@yourdomain.no`) — you'll put it in `EMAIL_FROM`.

Until this is done, every email send will fail and `console.log` fallback lines (only in non-production mode) won't help in prod.

## Step 4 — Environment variables

Open `.env` and set every value. None of these have safe defaults for production.

### Generate the secrets

```bash
# JWT signing key (required)
openssl rand -hex 64

# Postgres password (required)
openssl rand -base64 32

# MinIO secret key (required, ≥8 chars)
openssl rand -base64 32
```

### `.env` checklist

| Variable | Example | Notes |
|---|---|---|
| `POSTGRES_USER` | `expense_user` | Stays simple |
| `POSTGRES_PASSWORD` | `<openssl rand>` | Strong, opaque |
| `DATABASE_URL` | `postgres://expense_user:<password>@db:5432/expense_tracker` | Hostname is `db` (Docker service name), not `localhost` |
| `MINIO_ACCESS_KEY` | `minioadmin` or stronger | |
| `MINIO_SECRET_KEY` | `<openssl rand>` | ≥8 chars |
| `JWT_ACCESS_SECRET` | `<openssl rand -hex 64>` | If you rotate this, all sessions invalidate |
| `OPENAI_API_KEY` | `sk-...` | From platform.openai.com |
| `RESEND_API_KEY` | `re_...` | From resend.com |
| `EMAIL_FROM` | `noreply@yourdomain.no` | Must be on a Resend-verified domain |
| `APP_URL` | `https://tracker.yourdomain.no` | Used in invite + settlement email links |
| `WEB_ORIGIN` | `https://tracker.yourdomain.no` | CORS allow-list; must match `APP_URL` |
| `WEB_PORT` | `80` | Host port the `web` container binds to. The tunnel talks to `web:80` over the Docker network directly, not through this host port — this is only for LAN access (e.g. `http://<host-lan-ip>`). Fine to leave at the default; drop the `ports:` entry from `docker-compose.yml` entirely if you don't want LAN access either. |
| `TUNNEL_TOKEN` | `eyJhIjoi...` | From the Cloudflare Zero Trust tunnel's "Install connector" step (Step 2). Powers the `cloudflared` service — the only component with a route in from the internet. |

The compose file hardcodes `NODE_ENV: production` for the `api` service, so the dev-only invite/settlement console.logs (`backend/src/services/email.ts`) stay silent in prod. No action needed.

## Step 5 — First deploy

```bash
docker compose pull        # pull base images
docker compose build       # build api + web images
docker compose up -d       # start everything in background
docker compose ps          # all services should reach (healthy)
docker compose logs -f api # watch for "listening on 3001"
```

If any service stays unhealthy, `docker compose logs <service>` will tell you why. Common stumbles: wrong `DATABASE_URL` hostname, MinIO secret key shorter than 8 chars, missing `OPENAI_API_KEY` so receipt parser fails on first upload.

## Step 6 — Run migrations

Migrations don't run automatically. After the `db` and `api` services are healthy:

```bash
docker compose exec api npm run migrate:prod
```

Expect to see every migration from `001_create_all_tables.sql` through `008_settlement_expenses_snapshot.sql` listed. On a fresh database all will be `apply`. On an upgrade only new ones will be `apply` — the rest `skip`.

Re-run this after any future deploy that adds files to `backend/src/db/migrations/`.

## Step 7 — Create the MinIO bucket

The `receipts` bucket is what the app uploads to. Compose doesn't create it, and the base
compose file publishes no MinIO port on the host — run this from inside the container:

```bash
docker compose exec storage mc alias set local http://localhost:9000 "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"
docker compose exec storage mc mb local/receipts
```

## Step 8 — Create the first user

There is no public registration route — accounts exist only by invitation, and the very first
account has no inviter. Create it from the host:

```bash
docker compose exec api node dist/cli/create-user.js --email you@yourdomain.no --name "Your Name"
```

You'll be prompted for a password (typed, not echoed, never passed as an argument). The command
refuses if the email already exists.

1. Open `https://tracker.yourdomain.no` and log in with that email and password.
2. Create a household (`/create-household`). The creator is automatically the admin.
3. Invite your household members via the Settings page. They get an email with an accept-invite link.

## Verification checklist

Run this after first deploy, and again after any change to `docker-compose.yml`, `web/nginx.conf`,
or the tunnel config. All of it targets the *public* hostname — that's what a stranger, or your
phone on cellular, actually reaches.

1. **Port check — only the tunnel path serves the app.** From a machine outside your LAN (a phone
   on cellular works), confirm the object store and API aren't directly reachable:
   ```bash
   nmap -Pn -p 9000,3001 <your-public-ip-or-hostname>
   ```
   Both should show `filtered` or `closed` — `cloudflared` makes an outbound-only connection, so
   nothing should be listening on those ports from the outside at all. If you dropped `web`'s
   `ports:` mapping too, port 80 should be closed as well; the tunnel is the only way in regardless.
2. **Header check.**
   ```bash
   curl -I https://tracker.yourdomain.no
   ```
   Expect `content-security-policy`, `strict-transport-security`, `x-content-type-options:
   nosniff`, `referrer-policy`, and `permissions-policy` in the response. Attach this output to
   the deployment ticket/issue as evidence.
3. **CSP console check.** Open the public hostname in a browser with devtools open and walk
   through login, expense list, scan, draft review, an expense with a receipt image, settlement,
   projects, statistics, and settings. Zero CSP violations in the console — the policy is verified
   against the running app, not assumed.
4. **Client IP check.** Trigger a failed login and check `docker compose logs api` for the
   request: `x-forwarded-for` / the rate-limit key should show the real client (your phone's/browser's
   public IP), not a Cloudflare or Docker-internal address. `backend/test/rate-limit.test.ts` pins
   the same behavior at the unit level (nginx forwards `CF-Connecting-IP`; the API trusts exactly
   one hop).
5. **Cellular check (SC-002).** On a phone on cellular, off the home Wi-Fi entirely: log in, scan
   a receipt, review the draft, confirm it. This is the actual acceptance test — the previous four
   steps are diagnostics for when this one fails.

## Step 9 — Backups

You only need to back up two Docker volumes — everything else is reproducible from git.

```bash
# Stop services briefly, snapshot volumes, restart.
docker compose stop
docker run --rm -v expense-tracker_postgres_data:/data -v "$PWD/backups:/backup" alpine \
  tar czf /backup/postgres-$(date +%Y%m%d).tar.gz -C /data .
docker run --rm -v expense-tracker_minio_data:/data -v "$PWD/backups:/backup" alpine \
  tar czf /backup/minio-$(date +%Y%m%d).tar.gz -C /data .
docker compose start
```

Schedule with cron or a systemd timer. Store the resulting tarballs somewhere off the host (rsync to a NAS, B2, rclone to Google Drive, etc.).

For a richer Postgres backup, prefer `pg_dump` over a raw volume tarball — survives across major version upgrades:

```bash
docker compose exec db pg_dump -U "$POSTGRES_USER" expense_tracker | gzip > backups/db-$(date +%Y%m%d).sql.gz
```

## Step 9.5 — Rotating secrets

Rotate on a schedule (e.g. yearly) and immediately on any suspected exposure
(a leaked `.env`, a departed housemate, a compromised laptop). All secrets live
in `.env` on the host; the app validates them at boot and refuses to start on a
placeholder. After editing `.env`, apply with `docker compose up -d` (recreates
the `api` container with the new environment) unless noted otherwise.

| Secret | How to rotate | Blast radius when you rotate |
|--------|---------------|------------------------------|
| `JWT_ACCESS_SECRET` | `openssl rand -hex 64` → replace → `docker compose up -d api` | All **access** tokens become invalid immediately. Users don't notice: the browser silently fetches a new one via `/auth/refresh` (refresh tokens are stored in Postgres, not signed by this secret, so sessions survive). |
| `POSTGRES_PASSWORD` | Change the role password **first**, then update `.env` (the `DATABASE_URL` embeds it), then restart: <br>`docker compose exec db psql -U "$POSTGRES_USER" -c "ALTER USER \"$POSTGRES_USER\" PASSWORD 'new';"` <br>then edit `.env` → `docker compose up -d` | Brief: the API can't reach the DB between the `ALTER` and the restart. Do them back-to-back. |
| `MINIO_SECRET_KEY` / `MINIO_ACCESS_KEY` | Rotate the key in MinIO (console or `mc admin user svcacct`), update `.env`, `docker compose up -d` | The API is the only client of MinIO — restarting it picks up the new key immediately. Image access goes through the API's own session auth, so there's no signed-URL cache to worry about. |
| `OPENAI_API_KEY` | Revoke + recreate at platform.openai.com, update `.env`, `docker compose up -d api` | Receipt parsing fails until the new key is live — it degrades gracefully (empty items, hand-entry still works), so no data loss. |
| `RESEND_API_KEY` | Revoke + recreate at resend.com, update `.env`, `docker compose up -d api` | Invite + settlement emails fail to send until the new key is live. In-app flows are unaffected. |

Notes:
- **Forcing logout everywhere**: rotating `JWT_ACCESS_SECRET` does *not* end sessions
  (refresh re-mints tokens). To actually log everyone out, also revoke refresh tokens:
  `docker compose exec db psql -U "$POSTGRES_USER" expense_tracker -c "UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL;"`
- Keep the **old** `.env` until the new one is confirmed working, then shred it
  (`shred -u`), and rotate any secret that was ever committed or shared in plaintext.
- This deployment keeps secrets in a plaintext `.env`, which is appropriate for a
  single trusted host. A secrets manager (Vault, Doppler, cloud KMS) is only worth
  the operational weight if you outgrow that. See `THREAT-MODEL.md` (T7).

## Step 10 — Updates

```bash
git pull
docker compose build              # rebuild api + web with new code
docker compose up -d               # rolling restart
docker compose exec api npm run migrate:prod   # if any new migration files
```

If `package.json` changed in `shared/`, `web/`, or `backend/`, the build step picks it up. There's no separate `npm install` step on the host — everything happens inside the image builds.

## Troubleshooting

| Symptom | Look here |
|---|---|
| Login works but page is blank | Browser console — usually CORS. Check `WEB_ORIGIN` matches `APP_URL` exactly (https vs http, trailing slash). |
| Invite emails not arriving | `docker compose logs api \| grep -i resend`. Also check the Resend dashboard for delivery logs. Common cause: domain not yet verified or `EMAIL_FROM` not on the verified domain. |
| Settlement triggers but transaction "Mark paid" fails | `docker compose logs api` near the request time. Spec 003 changed the close handler; if you see `column does not exist`, you're missing migration 008. |
| Receipt upload "AI parse failed" | Either `OPENAI_API_KEY` invalid/out of credits, or the 15s timeout fired. Logs in `api` will show which. The app falls back to empty line items — user can fill them in manually. |
| Receipt/avatar images 403 or 404 | Images render through the API (`GET .../receipt`, `GET /users/me/avatar`), not MinIO directly. Check `docker compose logs api` for the actual authorization failure. |
| "client password must be a string" on `npm run migrate:prod` | `.env` not loaded. Should not happen via `docker compose exec api npm run migrate:prod` (env vars come from the container). |

## Operational notes specific to this build

- **JWT access tokens** live 15 minutes; refresh tokens 30 days, rotating on each use, stored as httpOnly `SameSite=strict` cookies. A user who leaves the tab open will silently re-auth as long as the refresh window holds.
- **All amounts** stored as integers in øre (1 NOK = 100 øre). Don't manually edit `total_amount_ore` or `unit_price_ore` in the database with decimals — the API rejects non-integers.
- **Settlement model** is snapshot-based (spec 003). One open settlement per household at a time. Triggering a settlement includes every `confirmed` expense regardless of `expense_date`. Statistics still bucket by `expense_date` month.
- **Migrations** are applied in lexicographic filename order, tracked in a `_migrations` table. Never edit an applied migration — write a new one.
- **The OpenAI receipt-parser timeout** is 15 seconds (`backend/src/services/receiptParser.ts`). On poor mobile networks the upload itself can take longer; that's separate from the parse window.

## What you'll set up *outside* this repo

- The Cloudflare zone, tunnel, and public hostname (Step 2) — DNS and TLS termination both live there now.
- DKIM/SPF/DMARC DNS records for Resend.
- Off-host backup destination.
- Resend account, OpenAI account.
- Optional: uptime monitoring (UptimeRobot, BetterUptime — free tiers fine for one app) pointed at `https://tracker.yourdomain.no/health`.
