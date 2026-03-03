-- ============================================
-- Credential Daily Stats
-- ============================================
-- Stores per-day delta credential and API key usage statistics,
-- enabling date-range filtering on the frontend.
--
-- Pattern: Same as daily_stats — one row per day with delta values.
-- The collector calculates deltas between consecutive syncs and
-- merges them into today's row via upsert.
--
-- Date: 2026-03-03
-- ============================================

CREATE TABLE IF NOT EXISTS credential_daily_stats (
    id SERIAL PRIMARY KEY,

    -- Date key (one row per day, local timezone)
    stat_date DATE NOT NULL UNIQUE,

    -- Per-credential daily delta usage (same JSONB schema as credential_usage_summary.credentials)
    credentials JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Per-API-key daily delta usage (same JSONB schema as credential_usage_summary.api_keys)
    api_keys JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Quick-access totals
    total_credentials INTEGER DEFAULT 0,
    total_api_keys INTEGER DEFAULT 0,

    -- Timestamp of last update
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_credential_daily_stats_date
    ON credential_daily_stats (stat_date);

-- Enable RLS
ALTER TABLE credential_daily_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read access to credential_daily_stats"
    ON credential_daily_stats FOR SELECT
    USING (true);

CREATE POLICY "Allow service role full access to credential_daily_stats"
    ON credential_daily_stats
    USING (auth.role() = 'service_role');

COMMENT ON TABLE credential_daily_stats IS 'Daily delta credential and API key usage stats. One row per day, merged on each collector sync. Enables date-range filtering on frontend.';
