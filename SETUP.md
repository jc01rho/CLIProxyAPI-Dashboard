# CLIProxy Dashboard — Setup Guide

Complete guide for setting up CLIProxy Dashboard from scratch using Docker Compose and a self-hosted PostgreSQL database.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose v2
- CLIProxy running with Management API enabled

> **No external database account needed.** PostgreSQL runs inside Docker automatically.

---

## 1. CLIProxy Configuration

Your CLIProxy must have the Management API enabled.

### Edit CLIProxy Config

```yaml
remote-management:
  allow-remote: true
  secret: "your-secure-secret-key-here"
```

### Verify Management API

```bash
curl -H "Authorization: Bearer your-secret-key-here" \
  http://localhost:8317/v0/management/usage
```

You should see a JSON response with usage data.

---

## 2. Installation

### Download docker-compose.yml

```bash
mkdir cliproxy-dashboard && cd cliproxy-dashboard

curl -O https://raw.githubusercontent.com/leolionart/CLIProxyAPI-Dashboard/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/leolionart/CLIProxyAPI-Dashboard/main/.env.example
cp .env.example .env
```

If you cloned this repository for development, initialize the tracker submodule:

```bash
git submodule update --init --recursive
```

### Configure Environment

Edit `.env`:

```env
# PostgreSQL password (choose any secure password)
DB_PASSWORD=your_secure_password_here

# CLIProxy connection
CLIPROXY_URL=http://host.docker.internal:8317
CLIPROXY_MANAGEMENT_KEY=your-secure-secret-key-here

# Optional
COLLECTOR_INTERVAL_SECONDS=300   # Poll interval (seconds), default 300
TIMEZONE_OFFSET_HOURS=7          # UTC offset, e.g. 7 for Vietnam/Bangkok
```

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_PASSWORD` | PostgreSQL password | **Required** |
| `CLIPROXY_URL` | CLIProxy Management API URL | `http://host.docker.internal:8317` |
| `CLIPROXY_MANAGEMENT_KEY` | CLIProxy management secret | **Required** |
| `COLLECTOR_INTERVAL_SECONDS` | Polling interval (seconds) | `300` |
| `TIMEZONE_OFFSET_HOURS` | Timezone offset from UTC | `7` |

### Start Services

```bash
docker compose up -d
```

Docker will automatically:
- Start PostgreSQL and create all tables on first boot
- Start the collector (polls CLIProxy every 5 minutes)
- Start PostgREST as the read-only API layer (after collector is healthy)
- Start the frontend dashboard (after postgrest starts)

### Expected Boot Order (release-safe)

1. `postgres` must be `healthy`
2. `collector` becomes `healthy` (DB init + migrations done)
3. `postgrest` starts after `collector` is healthy
4. `frontend` starts after `collector` is healthy and `postgrest` is started

### Access Dashboard

Open: **http://localhost:8417**

> First data appears after ~5 minutes (first collection cycle).

---

## 3. Verification

### Check Service Status

```bash
docker compose ps
```

All 4 services should show `healthy` or `running`:

```
NAME                   STATUS
cliproxy-postgres      healthy
cliproxy-postgrest     running
cliproxy-collector     healthy
cliproxy-dashboard     running
```

### Check Collector Logs

```bash
docker compose logs -f collector
```

Expected: periodic lines like `Collected snapshot: X requests, Y tokens`

### Manual Data Trigger

To collect data immediately without waiting:

```bash
curl -X POST http://localhost:8417/api/collector/trigger
```

---

## 4. Updating

```bash
docker compose pull
docker compose up -d
```

### Post-release smoke checks

```bash
docker compose ps
docker compose logs --tail=200 collector postgrest frontend
curl http://localhost:8417/api/collector/health
curl "http://localhost:8417/rest/v1/daily_stats?select=date,total_requests&order=date.desc&limit=1"
curl -X POST http://localhost:8417/api/collector/trigger
```

Success criteria:
- `collector` healthy and migration logs show applied/skipped without DB errors
- `postgrest` has no missing column/table errors after startup
- Collector health endpoint responds successfully
- PostgREST `daily_stats` read path works before and after manual trigger

---

## 5. Development Mode

### Frontend (Hot Reload)

```bash
# Start DB services first
docker compose up -d postgres postgrest

cd frontend
npm install
npm run dev     # http://localhost:5173
```

### Collector

```bash
cd collector
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py   # Requires DATABASE_URL env var
```

---

## Troubleshooting

### Collector can't connect to CLIProxy

- Ensure CLIProxy has `remote-management.allow-remote: true`
- Verify `CLIPROXY_MANAGEMENT_KEY` matches CLIProxy's `secret`
- On Linux, confirm `extra_hosts: host.docker.internal:host-gateway` resolves correctly

### Dashboard shows no data

- Wait 5 minutes for first collection cycle
- Check: `docker compose logs -f collector`
- Ensure all services are `healthy`: `docker compose ps`

### Port conflict on 8417

Change the port in `docker-compose.yml`:

```yaml
ports:
  - "8418:80"   # Change 8417 to any free port
```

Or set `DASHBOARD_PORT=8418` in `.env`.

### Existing PostgreSQL volume (schema missing tables)

If you had a previous postgres volume from before `init-db/` scripts were added,
the schema won't auto-apply. Run manually:

```bash
docker compose exec -T postgres psql -U cliproxy -d cliproxy < init-db/schema.sql
docker compose restart collector
```

### Behind a reverse proxy (Caddy/Nginx)

The frontend makes API calls to `/rest/v1/*` (PostgREST) and `/api/collector/*` (collector).
These must route to the dashboard container (port 8417), not your CLIProxy port.

Example Caddy snippet:

```
@dashboard path /rest/v1/* /api/collector/*
handle @dashboard {
  reverse_proxy 127.0.0.1:8417
}
```

---

## Architecture

```
Browser → Nginx (port 8417)
           ├── /rest/v1/*       → PostgREST:3000 (reads, anonymous)
           └── /api/collector/* → collector:5001 (writes + triggers)

Collector Flask → PostgreSQL:5432 (psycopg2, writes)
PostgREST       → PostgreSQL:5432 (reads)
```

The database is initialized from `init-db/schema.sql` (tables + PostgREST roles) and
`init-db/seed.sql` (default model pricing) on first boot when the volume is empty.
