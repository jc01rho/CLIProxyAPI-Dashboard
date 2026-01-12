# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-13
**Commit:** bb9b992
**Branch:** main

## OVERVIEW

CLIProxy Dashboard: Real-time API usage monitoring. Python collector polls CLIProxy every 5min, stores in Supabase; React frontend visualizes.

## RELATED PROJECTS

| Project | Path | Description |
|---------|------|-------------|
| **CLIProxyAPIPlus** | `D:\git\CLIProxyAPIPlus` | Backend proxy server (the CLIProxy being monitored) |

## STRUCTURE

```
./
├── collector/          # Python service (Flask + APScheduler)
│   ├── main.py         # Entry point, delta calculation, daily_stats
│   └── rate_limiter.py # Rate limit sync with restart detection
├── frontend/           # React dashboard (Vite)
│   └── src/
│       ├── App.jsx     # Data fetching, date range logic
│       └── components/ # Dashboard, RateLimitCard, Icons
├── docs/               # Internal documentation
└── docker-compose.yml  # Production deployment (GHCR images)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new API endpoint | `collector/main.py` | Flask Blueprint at `/api/collector/` |
| Modify data collection | `collector/main.py:store_usage_data()` | Delta calculation logic |
| Rate limit logic | `collector/rate_limiter.py` | Restart/false-start detection |
| Dashboard charts | `frontend/src/components/Dashboard.jsx` | Recharts, brand colors |
| Date range queries | `frontend/src/App.jsx:fetchData()` | Baseline snapshot logic |
| Supabase schema | `README.md` | SQL in "Initial Setup" section |
| Model pricing | `collector/main.py:DEFAULT_PRICING` | Also fetches from llm-prices.com |

## CONVENTIONS

### Timezone Handling
- `TIMEZONE_OFFSET_HOURS` env var (default: 7 for UTC+7)
- All date boundaries: local time -> UTC for DB storage
- Frontend converts local midnight to UTC for queries

### Delta Calculation (CRITICAL)
- CLIProxy returns **cumulative** counters
- Collector calculates **incremental deltas** between snapshots
- Restart detection: if `new < old`, treat `new` as the delta
- False start detection: skip models with >$10 cost spike on first appearance

### Database Patterns
- `daily_stats.breakdown` JSON stores per-model/endpoint aggregates
- Frontend prefers `breakdown` data over recalculating from snapshots
- `rate_limit_status` upserted on `config_id` conflict

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER** commit `.env` or `service_role` keys
- **NEVER** re-run pricing logic in frontend (costs stored contemporaneously)
- **NEVER** query snapshots directly for totals (use `daily_stats`)
- **AVOID** negative deltas in stats (indicates restart, handle specially)

## COMMANDS

```bash
# Development
cd frontend && npm run dev      # localhost:5173
cd collector && python main.py  # Requires .env

# Docker
docker compose up -d            # Start services
docker compose logs -f collector
http://localhost:8417           # Dashboard

# Rebuild
docker compose down && docker compose build --no-cache && docker compose up -d
```

## ENVIRONMENT

**Required:**
- `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (collector)
- `CLIPROXY_URL`, `CLIPROXY_MANAGEMENT_KEY`

**Optional:**
- `COLLECTOR_INTERVAL_SECONDS` (default: 300)
- `TIMEZONE_OFFSET_HOURS` (default: 7)

## NOTES

- Collector port 5001 internal only (not exposed)
- Frontend queries Supabase directly, not collector
- `host.docker.internal` for Docker -> host CLIProxy access
- Health check: `/api/collector/health` must pass before frontend starts
- Watchtower disabled via labels (manual updates only)
