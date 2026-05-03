-- Migration: 0011_add_request_events_cost_provider.sql
-- Adds provider and estimated_cost_usd columns to request_events.
-- provider: AI provider name (e.g. openai, anthropic, google).
-- estimated_cost_usd: per-request cost derived from model pricing at ingest time.

BEGIN;

ALTER TABLE request_events
    ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(20, 6) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_request_events_provider_name_occurred
    ON request_events(provider, occurred_at DESC)
    WHERE provider != '';

COMMIT;
