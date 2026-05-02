-- Migration: 0010_add_request_events_request_id.sql
-- Adds request_id column for Redis queue event deduplication.

BEGIN;

ALTER TABLE request_events
    ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_request_events_request_id
    ON request_events(request_id) WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_request_events_provider_occurred
    ON request_events((raw_detail->>'provider'), occurred_at DESC)
    WHERE raw_detail->>'provider' IS NOT NULL;

COMMIT;
