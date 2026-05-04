# DASHBOARD KNOWLEDGE BASE

**Generated:** 2026-05-04
**Commit:** 9bc8d9a
**Branch:** main

## OVERVIEW

Usage and operations dashboard for CLIProxy. It combines a Python Flask collector, PostgreSQL/PostgREST or Supabase storage, and a React 18 dashboard frontend.

## STRUCTURE

```text
CLIProxyAPI-Dashboard/
├── collector/       # Flask API, scheduler, sync jobs, Postgres client
├── frontend/        # React dashboard and nginx/PostgREST proxy
├── init-db/         # fresh-install schema and seed
├── plugin/          # skill telemetry plugin
├── docs/
└── docker-compose.yml
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Collector entry | `collector/main.py` | Flask routes + APScheduler + sync flows. |
| DB client/migrations | `collector/db.py`, `collector/migrations/` | Local Postgres Supabase-like layer. |
| Fresh schema | `init-db/schema.sql`, `init-db/schema.supabase.sql` | Must match migrations. |
| Request events | `collector/main.py`, `frontend/src/components/RequestEventsPanel.jsx` | Provider/cost/event details. |
| Credential stats | `collector/credential_stats_sync.py`, `frontend/src/components/CredentialStatsCard.jsx` | Daily + summary views. |
| Frontend data layer | `frontend/src/lib/database.js` | Chooses PostgREST vs Supabase. |

## DATA FLOW

```text
CLIProxyAPIPlus
  ├─ /v0/management/usage-queue  → request_events
  ├─ Redis queue cliproxy:*       → request_events
  └─ legacy /usage (management mode only) → usage_snapshots/model_usage/daily_stats
collector/main.py → Postgres/PostgREST or Supabase → frontend panels
```

## CONVENTIONS

- Schema changes require `init-db/schema.sql`, `init-db/schema.supabase.sql`, and a new `collector/migrations/*.sql` file.
- Request event storage includes `provider` and `estimated_cost_usd`; keep CSV/filter/export fields aligned.
- Dashboard Plus usage collection can run every sync; DB writes are gated by `MODEL_USAGE_UPLOAD_INTERVAL_SECONDS`.
- Model usage compaction keeps the latest cumulative snapshot per 30-minute bucket; do not sum cumulative rows.

## ANTI-PATTERNS

- Do not modify only migrations or only schema.sql.
- Do not store raw API keys/source IDs in `request_events`; use redaction helpers.
- Do not assume Supabase and local PostgREST expose identical errors; handle schema-cache missing-table cases.
- Do not let frontend bypass `src/lib/database.js` for data source selection.

## COMMANDS

```bash
cd collector
python3 -m py_compile main.py
python3 -m unittest test_model_usage_compaction.py test_main_retention.py test_redis_queue_sync.py test_request_events_api.py

cd ../frontend
npm run build

cd ..
COMPOSE_PROFILES=localdb docker compose up -d
```

## SUB-DOCUMENTS

```text
collector/AGENTS.md
frontend/AGENTS.md
```
