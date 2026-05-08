# Deployment Guide

## Getting This Live

You have a few options, roughly ordered from simplest to most flexible:

### Option A: VPS with Docker Compose (Easiest)

Run the same `docker compose` setup on a small VPS (Hetzner, DigitalOcean, Linode — ~$5-10/mo).

1. **Provision a VPS** with Docker installed
2. **Clone the repo** and copy your `.env` with production secrets
3. **Generate real secrets**:
   ```bash
   openssl rand -hex 64  # for JWT_ACCESS_SECRET
   openssl rand -hex 64  # for JWT_REFRESH_SECRET
   openssl rand -hex 32  # for POSTGRES_PASSWORD
   openssl rand -hex 32  # for MINIO_SECRET_KEY
   ```
4. **Remove the `docker-compose.override.yml`** (or rename it) — the base compose file already has production settings (no exposed DB/MinIO ports, no bind mounts)
5. **Add a reverse proxy** (Caddy is simplest) for HTTPS:
   ```
   yourdomain.com {
       reverse_proxy web:3000
   }
   ```
6. **Set `APP_URL`** in `.env` to your domain
7. `docker compose up -d`

### Option B: Railway / Render / Fly.io

These platforms support Docker-based deploys. You'd need to split services (they each get their own container) and use their managed Postgres + S3-compatible storage instead of self-hosted MinIO.

## What You Need Regardless

| Item | Notes |
|------|-------|
| **Domain name** | For HTTPS + sharing the URL with your partner |
| **OpenAI API key** | For receipt parsing (you already have one) |
| **Resend API key** | For invite emails — or remove email and share invite links manually |
| **DNS** | Point your domain to the server IP |

## Things to Lock Down for Production

- Change all default passwords/secrets in `.env`
- Remove the `docker-compose.override.yml` (it exposes DB/MinIO ports)
- The base `docker-compose.yml` already runs the web frontend as a production Vite build behind nginx — no changes needed there
