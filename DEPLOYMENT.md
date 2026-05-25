# Deployment

Operational checklist for hosting this app on a real machine reachable at a real domain. Reflects the state of the codebase as of 2026-05-25 (post-spec-003).

> There are older notes in `resources/deployment-guide.md` and `resources/server-deploy.md`. This file is the current one — start here.

## What you're deploying

Four Docker services come up together via `docker-compose.yml`:

| Service | Image | Purpose | Internal port |
|---|---|---|---|
| `db` | `postgres:16-alpine` | Application database | 5432 |
| `storage` | `minio:RELEASE.2025-09-07T16-13-09Z` | Receipt image storage (S3-compatible) | 9000 / 9001 console |
| `api` | built from `backend/Dockerfile` | Express + WebSocket server | 3001 |
| `web` | built from `web/Dockerfile` | nginx serving the React bundle + proxying `/api` to `api` | 80 |

Persistent state lives in two Docker volumes: `postgres_data` and `minio_data`. Back both up.

## Prerequisites

- A Linux host you control (laptop, NUC, mini-PC, VPS — anything that can keep Docker running).
- Docker Engine + Docker Compose v2 installed.
- A domain you control (your boyfriend's domain). Subdomain is fine, e.g. `tracker.yourdomain.no`.
- Accounts:
  - **Resend** (resend.com) — transactional email for invites and settlement notifications.
  - **OpenAI** — used by `backend/src/services/receiptParser.ts` for receipt OCR (`gpt-4o-mini`). Free tier won't be enough long-term; budget a few dollars/month.

## Step 1 — Get the code on the host

```bash
git clone git@github.com:echosmasher/expense-tracker.git
cd expense-tracker
cp .env.example .env
```

Edit `.env` next — do not start anything yet.

## Step 2 — Domain & networking

You have two reasonable paths. Pick one.

### Option A — Port forwarding on your home router

1. Give the host machine a static internal IP (DHCP reservation in the router).
2. Forward router ports `80` and `443` → host's internal IP.
3. In the domain's DNS, create an `A` record for `tracker.yourdomain.no` pointing at your **public** IP.
4. If your public IP changes (most home ISPs), set up dynamic DNS — e.g. via your DNS provider's API, or services like duckdns.org / no-ip.com.

### Option B — Cloudflare Tunnel (recommended if you don't want to open router ports)

1. Sign up at cloudflare.com, add `yourdomain.no` as a zone.
2. Install `cloudflared` on the host, run `cloudflared tunnel login`, create a tunnel, route `tracker.yourdomain.no` to `http://localhost:80`.
3. No port forwarding, no public IP exposure, no Let's Encrypt config — Cloudflare terminates TLS.

Either option ends with `https://tracker.yourdomain.no` reaching the `web` container.

## Step 3 — TLS / HTTPS

Whatever the app's invite-email links say in `APP_URL` is what people will click. Plan for HTTPS from day one.

| Path you took in Step 2 | What handles TLS |
|---|---|
| Option A (port forwarding) | Add a reverse proxy in front of the `web` service. Easiest: **Caddy** as a sibling container — auto-renews Let's Encrypt certs. Or **nginx-proxy-manager** if you prefer a UI. Point it at the `web` container on port 80. Open router ports `80` and `443`. |
| Option B (Cloudflare Tunnel) | Cloudflare terminates TLS. App stays HTTP internally; you set `APP_URL=https://tracker.yourdomain.no` regardless. |

Do NOT serve plain HTTP to the public internet — refresh tokens are httpOnly cookies with `SameSite=strict`; some browsers will silently reject them on insecure origins.

## Step 4 — Verify the domain in Resend

Required for any invite or settlement email to actually deliver.

1. resend.com → Domains → Add Domain (e.g. `yourdomain.no`).
2. Copy the DKIM, SPF, and DMARC DNS records Resend shows.
3. Add them to the domain's DNS. DNS propagation can take an hour, sometimes longer.
4. Wait for the domain to show "Verified" in Resend.
5. Pick a sender address on that domain (e.g. `noreply@yourdomain.no`) — you'll put it in `EMAIL_FROM`.

Until this is done, every email send will fail and `console.log` fallback lines (only in non-production mode) won't help in prod.

## Step 5 — Environment variables

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
| `MINIO_PUBLIC_ENDPOINT` | `https://tracker.yourdomain.no/storage` or a separate `https://storage.yourdomain.no` | This is what the **browser** uses to fetch signed image URLs — it must be reachable from users' devices, NOT from inside Docker. If you don't expose MinIO publicly, set up a path-based proxy through nginx/Caddy. |
| `MINIO_PUBLIC_PORT` | `9000` or omit if proxied through 443 | |
| `JWT_ACCESS_SECRET` | `<openssl rand -hex 64>` | If you rotate this, all sessions invalidate |
| `OPENAI_API_KEY` | `sk-...` | From platform.openai.com |
| `RESEND_API_KEY` | `re_...` | From resend.com |
| `EMAIL_FROM` | `noreply@yourdomain.no` | Must be on a Resend-verified domain |
| `APP_URL` | `https://tracker.yourdomain.no` | Used in invite + settlement email links |
| `WEB_ORIGIN` | `https://tracker.yourdomain.no` | CORS allow-list; must match `APP_URL` |
| `WEB_PORT` | `80` | Host port the `web` container binds to. Leave 80 if a reverse proxy handles 443; if you're serving directly, you'll need 443 + TLS termination in `web/Dockerfile` (not the current setup). |

The compose file hardcodes `NODE_ENV: production` for the `api` service, so the dev-only invite/settlement console.logs (`backend/src/services/email.ts`) stay silent in prod. No action needed.

## Step 6 — First deploy

```bash
docker compose pull        # pull base images
docker compose build       # build api + web images
docker compose up -d       # start everything in background
docker compose ps          # all services should reach (healthy)
docker compose logs -f api # watch for "listening on 3001"
```

If any service stays unhealthy, `docker compose logs <service>` will tell you why. Common stumbles: wrong `DATABASE_URL` hostname, MinIO secret key shorter than 8 chars, missing `OPENAI_API_KEY` so receipt parser fails on first upload.

## Step 7 — Run migrations

Migrations don't run automatically. After the `db` and `api` services are healthy:

```bash
docker compose exec api npm run migrate
```

Expect to see every migration from `001_create_all_tables.sql` through `008_settlement_expenses_snapshot.sql` listed. On a fresh database all will be `apply`. On an upgrade only new ones will be `apply` — the rest `skip`.

Re-run this after any future deploy that adds files to `backend/src/db/migrations/`.

## Step 8 — Create the MinIO bucket

The `receipts` bucket is what the app uploads to. Compose doesn't create it. Either:

- Visit `https://<host>:9001` (MinIO console), log in with `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`, create a bucket named `receipts`.
- Or run from the host:
  ```bash
  docker compose exec storage mc alias set local http://localhost:9000 "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"
  docker compose exec storage mc mb local/receipts
  ```

## Step 9 — Create the first user

There is no admin seed user. Register through the UI:

1. Open `https://tracker.yourdomain.no` in a browser.
2. Click **Register** — create your account.
3. Create a household (`/create-household`). The creator is automatically the admin.
4. Invite your household members via the Settings page. They get an email with an accept-invite link.

## Step 10 — Backups

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

## Step 11 — Updates

```bash
git pull
docker compose build              # rebuild api + web with new code
docker compose up -d               # rolling restart
docker compose exec api npm run migrate   # if any new migration files
```

If `package.json` changed in `shared/`, `web/`, or `backend/`, the build step picks it up. There's no separate `npm install` step on the host — everything happens inside the image builds.

## Troubleshooting

| Symptom | Look here |
|---|---|
| Login works but page is blank | Browser console — usually CORS. Check `WEB_ORIGIN` matches `APP_URL` exactly (https vs http, trailing slash). |
| Invite emails not arriving | `docker compose logs api \| grep -i resend`. Also check the Resend dashboard for delivery logs. Common cause: domain not yet verified or `EMAIL_FROM` not on the verified domain. |
| Settlement triggers but transaction "Mark paid" fails | `docker compose logs api` near the request time. Spec 003 changed the close handler; if you see `column does not exist`, you're missing migration 008. |
| Receipt upload "AI parse failed" | Either `OPENAI_API_KEY` invalid/out of credits, or the 15s timeout fired. Logs in `api` will show which. The app falls back to empty line items — user can fill them in manually. |
| Image thumbnails 403 / signature mismatch | `MINIO_PUBLIC_ENDPOINT` is wrong. It must be the URL the **browser** uses, not the internal Docker URL. |
| "client password must be a string" on `npm run migrate` | `.env` not loaded. Should not happen via `docker compose exec api npm run migrate` (env vars come from the container). |

## Operational notes specific to this build

- **JWT access tokens** live 15 minutes; refresh tokens 30 days, rotating on each use, stored as httpOnly `SameSite=strict` cookies. A user who leaves the tab open will silently re-auth as long as the refresh window holds.
- **All amounts** stored as integers in øre (1 NOK = 100 øre). Don't manually edit `total_amount_ore` or `unit_price_ore` in the database with decimals — the API rejects non-integers.
- **Settlement model** is snapshot-based (spec 003). One open settlement per household at a time. Triggering a settlement includes every `confirmed` expense regardless of `expense_date`. Statistics still bucket by `expense_date` month.
- **Migrations** are applied in lexicographic filename order, tracked in a `_migrations` table. Never edit an applied migration — write a new one.
- **The OpenAI receipt-parser timeout** is 15 seconds (`backend/src/services/receiptParser.ts`). On poor mobile networks the upload itself can take longer; that's separate from the parse window.

## What you'll set up *outside* this repo

- DNS records for the domain (A record + DKIM/SPF/DMARC for Resend).
- Reverse proxy / TLS termination (Caddy / nginx-proxy-manager / Cloudflare Tunnel).
- Off-host backup destination.
- Resend account, OpenAI account.
- Optional: uptime monitoring (UptimeRobot, BetterUptime — free tiers fine for one app) pointed at `https://tracker.yourdomain.no/health`.
