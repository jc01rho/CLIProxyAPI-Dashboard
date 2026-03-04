# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CLIProxy Dashboard is a real-time monitoring system that tracks API usage from CLIProxy (an AI API proxy). It consists of:

- **Collector** (Python/Flask): Polls the CLIProxy Management API every 5 minutes, processes usage data, calculates costs, and stores to PostgreSQL via psycopg2
- **Frontend** (React/Nginx): Visualizes usage analytics with charts, cost breakdowns, and credential tracking
- **PostgreSQL**: Self-hosted database, auto-initialized from `init-db/schema.sql` on first boot
- **PostgREST**: REST API layer for frontend reads (anonymous, SELECT-only via `web_anon` role)

**Data Flow:**
```
CLIProxy API → Collector (Python/Flask) → PostgreSQL:5432
Browser → Nginx:8417 → /rest/v1/* → PostgREST:3000 → PostgreSQL (reads)
                      → /api/collector/* → collector:5001 (writes + triggers)
```

## Common Commands

### Development

**Frontend (requires postgres + postgrest running in Docker):**
```bash
docker compose up -d postgres postgrest   # Start DB services first
cd frontend
npm install
npm run dev          # Start Vite dev server on localhost:5173
```

**Collector (local testing):**
```bash
cd collector
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt
python main.py       # Requires DATABASE_URL env var
```

### Docker Operations

**Start all services:**
```bash
docker compose up -d
```

**View logs:**
```bash
docker compose logs -f                    # All services
docker compose logs -f collector          # Collector only
docker compose logs -f frontend           # Frontend only
docker compose logs -f postgres           # PostgreSQL only
```

**Check health:**
```bash
docker compose ps
```

**Restart services:**
```bash
docker compose restart collector
docker compose restart frontend
```

**Access dashboard:**
```
http://localhost:8417
```

## Architecture

### Database Schema (PostgreSQL self-hosted)

Schema auto-applied from `init-db/schema.sql` on first postgres container boot.

**Core Tables:**
- `usage_snapshots`: Raw snapshots collected every 5 minutes
- `model_usage`: Per-model breakdown of each snapshot (FK → usage_snapshots.id CASCADE DELETE)
- `daily_stats`: Daily aggregated statistics (upserted daily)
- `model_pricing`: Pricing config (USD per 1M tokens), supports wildcard pattern matching
- `credential_usage_summary`: OAuth credential status (singleton row, id=1)
- `credential_daily_stats`: Daily credential usage breakdown

**PostgREST Access:**
- `web_anon` role has SELECT-only on all tables
- PostgREST uses `web_anon` when no Authorization header present
- nginx and Vite proxy both strip `Authorization` and `apikey` headers → PostgREST always uses anonymous role

### Collector Architecture (collector/main.py + collector/db.py)

**Core Components:**
1. **Flask API Server** (port 5001, Waitress WSGI):
   - `/api/collector/health` — Health check
   - `/api/collector/trigger` — Manual sync trigger

2. **Background Scheduler** (APScheduler):
   - Polls CLIProxy API every `COLLECTOR_INTERVAL_SECONDS` (default: 300s)
   - Calculates usage deltas, stores snapshots + daily_stats

3. **PostgreSQL Client** (`collector/db.py`):
   - `PostgreSQLClient` wraps `psycopg2.pool.ThreadedConnectionPool`
   - Mimics supabase-js Python SDK interface (`.table().select().eq().execute()`)
   - Handles JSONB column auto-wrapping via `psycopg2.extras.Json`
   - INSERT uses `RETURNING *` to get auto-generated IDs

**Critical Implementation Details:**
- **Delta Calculation**: Cumulative snapshots from CLIProxy → daily deltas by subtracting previous snapshot
- **Restart Detection**: If new value < old value, treat new value as delta (handles CLIProxy restarts)
- **Timezone Handling**: `TIMEZONE_OFFSET_HOURS` env var (default: 7 for UTC+7); all date boundaries calculated in local time, stored as UTC

### Frontend Architecture (frontend/src/)

**Main Components:**
- `App.jsx`: Date range selection, data fetching via supabase-js → PostgREST
- `Dashboard.jsx`: All visualization cards
- `lib/supabase.js`: PostgREST client — uses `window.location.origin` as URL, `'anon'` as key (JWT never sent)

**Date Range Logic** (App.jsx):
- Today/Yesterday → query `daily_stats` exact date, show **delta**
- Multi-day ranges → aggregate multiple `daily_stats` rows, show **total**

**Key Libraries:**
- `@supabase/supabase-js` — PostgREST queries (FK embedding via `model_usage(...)`)
- `recharts` — Charts
- React 18 + Vite

## Environment Configuration

**Required:**
- `DB_PASSWORD`: PostgreSQL password
- `CLIPROXY_URL`: CLIProxy Management API URL (`host.docker.internal:PORT` from Docker)
- `CLIPROXY_MANAGEMENT_KEY`: CLIProxy management secret

**Optional:**
- `COLLECTOR_INTERVAL_SECONDS`: Polling interval (default: 300)
- `TIMEZONE_OFFSET_HOURS`: UTC offset (default: 7)

## Docker Configuration

**Services:**
- `postgres`: PostgreSQL 16, auto-initialized from `init-db/schema.sql`, volume `postgres_data`
- `postgrest`: PostgREST v12.2.3, reads from postgres, anonymous role `web_anon`
- `collector`: Python Flask, writes to postgres via psycopg2, port 5001 (internal only)
- `frontend`: Nginx on port 8417, proxies `/rest/v1/` → postgrest, `/api/collector/` → collector

Images are published to GHCR (`ghcr.io/leolionart/cliproxy-*`) via GitHub Actions. Use `docker compose pull` to update.

## Cost Calculation

- Model name matched against `model_pattern` in `model_pricing` (wildcard)
- Cost = (input_tokens / 1M) × input_price + (output_tokens / 1M) × output_price
- `MODEL_PRICING_DEFAULTS` in `collector/main.py` seeded on first run

**To update pricing:** Edit `model_pricing` table directly via psql or update `MODEL_PRICING_DEFAULTS` and restart collector.

## Troubleshooting Notes

**Collector Can't Connect to CLIProxy:**
- Verify CLIProxy has `remote-management.allow-remote: true`
- Check `CLIPROXY_MANAGEMENT_KEY` matches CLIProxy's `secret`
- Use `host.docker.internal` (mapped to host gateway in docker-compose)

**Dashboard Shows No Data:**
- Wait 5 minutes for first collection cycle
- Check: `docker compose logs -f collector`
- Ensure all services are `healthy`: `docker compose ps`

**PostgREST JWT Errors:**
- Both nginx and Vite proxy strip `Authorization`/`apikey` headers
- If seeing JWT errors, check those proxy configs are correct

**Date Range Showing Wrong Data:**
- Verify `TIMEZONE_OFFSET_HOURS` matches your timezone
- `daily_stats` must have entries for the date range
