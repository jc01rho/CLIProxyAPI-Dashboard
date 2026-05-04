# DASHBOARD COLLECTOR

> Parent: [../AGENTS.md](../AGENTS.md)

## OVERVIEW

`collector/` is the Python operational backend: Flask auth/API routes, scheduled sync jobs, local PostgreSQL client, Redis usage queue consumer, migration runner, and compaction/retention logic.

## STRUCTURE

```text
collector/
├── main.py
├── db.py
├── credential_stats_sync.py
├── redis_queue_client.py
├── migrations/
├── requirements.txt
└── test_*.py
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Scheduler/jobs | `main.py:main()` and job helpers | Sync, cleanup, compaction. |
| Request events | `_usage_queue_sync_once`, `_redis_queue_sync_once`, `_transform_queue_event` | Missing table guard prevents data loss. |
| Model usage compaction | `_floor_to_30min_bucket`, `_compact_model_usage_db` | Latest cumulative snapshot per bucket. |
| DB adapter | `db.py` | QueryBuilder + JSONB wrapping + migrations. |
| Credential deltas | `credential_stats_sync.py` | Summary/daily delta calculations. |
| Redis protocol | `redis_queue_client.py` | Pure stdlib RESP client. |

## CONVENTIONS

- `USAGE_SYNC_MODE=auto` drains queue/Redis and avoids legacy `/usage` polling by default.
- `request_events` availability is preflighted and throttled; do not drain queues when table is unavailable.
- Cloudflare-style HTML 502/522 cleanup failures are warning-only via `_is_html_gateway_error()`.
- `MAINTENANCE_DATABASE_URL` is used for `VACUUM (ANALYZE, TRUNCATE ON)` on large tables.

## TESTS

```bash
python3 -m py_compile main.py
python3 -m unittest test_model_usage_compaction.py test_main_retention.py test_redis_queue_sync.py test_request_events_api.py
python3 -m unittest test_credential_stats_sync.py
```

## ANTI-PATTERNS

- Do not pop request events from Plus/Redis before confirming table availability.
- Do not treat legacy `/v0/management/usage` 404 as a collector crash.
- Do not write source IDs/API keys raw into stored event detail.
- Do not change compaction to sum cumulative model_usage snapshots.
