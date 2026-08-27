# Server Deployment Guide

Dear operator

This guide walks you through deploying the **expense-tracker** app on a Docker host. The project is already wired for production deployment — this is just the operational steps.

## What you're deploying

A self-hosted shared expense tracker for two people. Four Docker services come up together:

| Service | What it does | Port |
|---|---|---|
| `web` | React app served by nginx, also reverse-proxies `/api/` and `/ws` to the backend | `${WEB_PORT:-80}` published on the host |
| `api` | Express backend (Node 20) | internal only |
| `db` | PostgreSQL 16 | internal only |
| `storage` | MinIO (S3-compatible, stores receipt images) | `${MINIO_PUBLIC_PORT:-9000}` published on the host |

Volumes `postgres_data` and `minio_data` are created by Docker on the host's local disk — that's where the actual data lives.

## Prerequisites on the server

- Docker (with Compose v2 — i.e. `docker compose ...`, not `docker-compose`)
- `git`
- Access to the private GitHub repo `echosmasher/expense-tracker`
- Free ports on the host: by default `80` (web) and `9000` (MinIO). If `80` is already taken, you can change `WEB_PORT` (see step 3).

## Step 1 — Get the code onto the server

The repo is private, so the server needs credentials. Recommended: a **deploy key** (read-only SSH key scoped to this single repo).

On the server:

```bash
# Generate a deploy key
ssh-keygen -t ed25519 -f ~/.ssh/expense_tracker_deploy -N "" -C "expense-tracker-deploy"

# Show the public key — copy this output
cat ~/.ssh/expense_tracker_deploy.pub
```

Then in GitHub: **Repo → Settings → Deploy keys → Add deploy key**, paste the public key, leave "allow write access" unchecked.

Tell ssh to use this key for github.com (one-off):

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
    IdentityFile ~/.ssh/expense_tracker_deploy
    IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
```

Now clone:

```bash
# Pick a place for the project — e.g. ~/apps
mkdir -p ~/apps && cd ~/apps
git clone git@github.com:echosmasher/expense-tracker.git
cd expense-tracker
```

You should be on the `master` branch (it's the default).

## Step 2 — Generate secrets

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
echo "MINIO_SECRET_KEY=$(openssl rand -hex 32)"
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 64)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 64)"
```

Keep these somewhere safe — you'll paste them into `.env` next.

## Step 3 — Create the `.env` file

```bash
cp .env.example .env
nano .env   # or vi, or whatever editor you prefer
```

Fill in the file. Here's what each variable needs:

```dotenv
# Postgres
POSTGRES_USER=expense_user
POSTGRES_PASSWORD=<paste from step 2>
DATABASE_URL=postgres://expense_user:<same password>@localhost:5432/expense_tracker

# MinIO
MINIO_ENDPOINT=http://localhost:9000
# IMPORTANT: this is the URL the BROWSER will use to fetch receipt images.
# It must be reachable from your phone/laptop, not just from inside Docker.
# Examples:
#   http://<server-lan-ip>:9000     (LAN-only, server's local IP)
#   http://nightmare.local:9000     (if you have mDNS)
#   https://expenses.yourdomain/storage   (if you front it with a reverse proxy)
MINIO_PUBLIC_ENDPOINT=http://<server-host-or-ip>:9000
MINIO_PUBLIC_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=<paste from step 2>
MINIO_BUCKET=receipts

# JWT
JWT_ACCESS_SECRET=<paste from step 2>
JWT_REFRESH_SECRET=<paste from step 2>

# OpenAI — used to parse receipt photos
OPENAI_API_KEY=sk-...

# Resend — for invite emails (or leave as-is and share invite links manually)
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@yourdomain.com

# App
PORT=3001
WEB_PORT=80           # change to e.g. 8080 if port 80 is taken on the host
APP_URL=http://<server-host-or-ip>   # used in invite/password emails
```

Save the file. Lock down permissions:

```bash
chmod 600 .env
```

## Step 4 — Build and start

```bash
# IMPORTANT: -f docker-compose.yml is REQUIRED in production.
# Without it, Compose also picks up docker-compose.override.yml,
# which is for development (exposes DB/MinIO directly, hot-reloads, etc.).
docker compose -f docker-compose.yml up -d --build
```

First run will take 5–15 minutes (downloads images, builds the backend and frontend). Subsequent runs reuse cached layers.

Check that everything started:

```bash
docker compose -f docker-compose.yml ps
```

All four services should be `running` (and `db`, `storage`, `api` should show `healthy` after a minute or so).

## Step 5 — Run database migrations

The backend doesn't auto-migrate. Run the migration script once:

```bash
docker compose -f docker-compose.yml exec api npm run migrate
```

You should see migrations execute and exit cleanly. If you see "relation already exists" errors, the migrations have already run — that's fine.

## Step 6 — Verify

From the server itself:

```bash
curl -I http://localhost/         # should return 200 from nginx
curl http://localhost/health   # should return JSON like {"status":"ok"}
```

From your phone or laptop, open `http://<server-host-or-ip>/` in a browser. You should see the login screen.

## Step 7 — First-time app setup

1. Click **Register** and create an account (this becomes the household admin).
2. Create the household.
3. Invite the other household members using the **Members** screen. The invite email goes via Resend; if you skipped Resend, copy the invite link from the API response and send it manually.
4. Try uploading a receipt to confirm MinIO + signed URLs are working end-to-end. **If receipt images don't load in the browser, `MINIO_PUBLIC_ENDPOINT` is wrong** — fix it in `.env` and re-run `docker compose -f docker-compose.yml up -d` (no rebuild needed; just restart the api container).

## Updating later

When new code is pushed to GitHub:

```bash
cd ~/apps/expense-tracker
git pull
docker compose -f docker-compose.yml up -d --build
# If a migration was added in this update:
docker compose -f docker-compose.yml exec api npm run migrate
```

## Logs and debugging

```bash
# Tail all services
docker compose -f docker-compose.yml logs -f

# One service
docker compose -f docker-compose.yml logs -f api

# Restart one service
docker compose -f docker-compose.yml restart api

# Stop everything (keeps data)
docker compose -f docker-compose.yml down

# WIPE everything including the database (use with care)
docker compose -f docker-compose.yml down -v
```

## Backups

The data lives in two Docker volumes: `expense-tracker_postgres_data` and `expense-tracker_minio_data`. A simple backup pattern:

```bash
# Postgres dump
docker compose -f docker-compose.yml exec -T db \
  pg_dump -U expense_user expense_tracker | gzip > <backup-dir>/expense-tracker-$(date +%F).sql.gz

# MinIO objects (rsync from the named volume)
docker run --rm -v expense-tracker_minio_data:/data -v <backup-dir>:/backup alpine \
  tar czf /backup/minio-$(date +%F).tar.gz -C /data .
```

Drop those into a cron job if you want them automated.

## Optional: HTTPS via reverse proxy

The current setup runs HTTP on port 80. If you already have something like Caddy / Traefik / nginx-proxy-manager on this host, point it at the `web` container (or at host `:80`) and add TLS there. If you front the app with a domain over HTTPS, also update:

- `APP_URL=https://your-domain` in `.env`
- `MINIO_PUBLIC_ENDPOINT` to a route that's served over HTTPS (e.g. proxy `/storage/` through the same reverse proxy to the `storage` service on port 9000, and set the env var to `https://your-domain/storage`)

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Web loads but API calls hang or 502 | The `api` container isn't healthy. Check `docker compose logs api`. Common cause: missing/incorrect `JWT_*` or `DATABASE_URL` in `.env`. |
| Login works but receipt images don't load (broken-image icons) | `MINIO_PUBLIC_ENDPOINT` is wrong, or the host's port 9000 is firewalled, or signed URL signature mismatch. From your browser, try opening one of the receipt URLs directly — the error from MinIO usually tells you what's wrong. |
| `docker compose up` fails with "port is already allocated" | Something else on the host is using port 80 or 9000. Set `WEB_PORT` and/or `MINIO_PUBLIC_PORT` in `.env` to free ports. |
| Migrations fail with "database does not exist" | The Postgres container hasn't finished initializing on first run. Wait 15 seconds and re-run the migrate command. |
| Receipt parsing returns empty items | Check `OPENAI_API_KEY`. The receipt parser falls back to empty on any error. |

If something else breaks, capture the output of `docker compose -f docker-compose.yml logs --tail=200`.
