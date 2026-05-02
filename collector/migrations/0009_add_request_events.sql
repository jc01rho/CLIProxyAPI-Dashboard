-- Migration: 0009_add_request_events.sql
-- Adds request-level usage event persistence table.

BEGIN;

CREATE TABLE IF NOT EXISTS request_events (
    id BIGSERIAL PRIMARY KEY,
    event_uid TEXT NOT NULL UNIQUE,
    snapshot_id BIGINT REFERENCES usage_snapshots(id) ON DELETE SET NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    api_endpoint TEXT NOT NULL DEFAULT '',
    endpoint_method TEXT NOT NULL DEFAULT '',
    endpoint_path TEXT NOT NULL DEFAULT '',
    model_name TEXT NOT NULL DEFAULT '',
    source_id TEXT NOT NULL DEFAULT '',
    auth_index TEXT NOT NULL DEFAULT '',
    latency_ms BIGINT NOT NULL DEFAULT 0,
    failed BOOLEAN NOT NULL DEFAULT FALSE,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    reasoning_tokens BIGINT NOT NULL DEFAULT 0,
    cached_tokens BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    raw_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_events_occurred_at
    ON request_events(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_events_model_occurred
    ON request_events(model_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_events_endpoint_occurred
    ON request_events(api_endpoint, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_events_source_occurred
    ON request_events(source_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_events_auth_occurred
    ON request_events(auth_index, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_events_failed_occurred
    ON request_events(failed, occurred_at DESC);

-- Grant read access to web_anon (self-hosted PostgREST role)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'web_anon') THEN
        GRANT SELECT ON request_events TO web_anon;
    END IF;
END
$$;

COMMIT;
