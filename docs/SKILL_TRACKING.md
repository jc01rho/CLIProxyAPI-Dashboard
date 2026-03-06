# Skill Tracking Pipeline (Mar 2026)

Summary for AI agents: how skill run telemetry flows from clients → collector → PostgREST → dashboard.

## Payload and endpoint

- **Endpoint:** `POST /api/collector/skill-events`
- **Body:** `{ "events": [ { machine_id, sqlite_id, skill_name, session_id, triggered_at?, trigger_type?, arguments?, tokens_used?, output_tokens?, tool_calls?, duration_ms?, skill_version_hash?, model?, is_skeleton? } ] }`
- **Validation:** requires `skill_name` and `session_id`; strings are trimmed to 100 chars. Empty/invalid rows are skipped and counted in `skipped`.
- **Idempotency:** unique key `(machine_id, sqlite_id, session_id, skill_name)`; upsert prevents duplicates coming from local SQLite mirrors.

## Storage

- **Tables:**
  - `skill_runs`: raw events with token/tool/duration/model info and `synced_at`.
  - `skill_daily_stats`: aggregated per `(stat_date, skill_name, machine_id)` with totals and `avg_tokens` computed column.
- **Migration:** `collector/migrations/0002_add_skill_tracking.sql` (applied automatically by `db.run_migrations()` on collector start). Grants `SELECT` to `web_anon` for PostgREST.

## Backend aggregation

After ingest:
1) Upsert each event into `skill_runs`.
2) For every `(date, skill_name, machine_id)` seen in non-skeleton events, recalc daily totals from `skill_runs` and upsert into `skill_daily_stats`.
3) Errors per event are logged and counted but do not abort the batch.

## Frontend consumption

- **Sources:**
  - `skill_runs` → recent runs table + per-skill rollups (run counts, token totals, machine count).
  - `skill_daily_stats` → daily time-series chart.
- **Component:** `frontend/src/components/SkillsPanel.jsx` renders metrics/charts. Estimated cost is derived client-side at $3/1M input + $15/1M output (no server-side pricing yet).

## Operational notes

- `is_skeleton=true` rows are stored but excluded from daily aggregates to avoid noise from scaffolding runs.
- Time fields are stored in UTC ISO strings; daily grouping uses the date portion of `triggered_at` in UTC.
- If a machine replays historical events, upserts keep only the latest copy but daily aggregates recompute totals each ingest, so backfills are safe.
