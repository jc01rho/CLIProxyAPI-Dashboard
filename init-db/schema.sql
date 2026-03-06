-- ============================================================
-- CLIProxy Dashboard - PostgreSQL Schema (Self-hosted)
-- Replaces Supabase-managed database
-- ============================================================

-- =====================
-- Core Tables
-- =====================

-- Raw usage snapshots collected every N minutes from CLIProxy
CREATE TABLE IF NOT EXISTS usage_snapshots (
    id BIGSERIAL PRIMARY KEY,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_requests INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    cumulative_cost_usd DECIMAL(18, 6) DEFAULT 0,
    raw_data JSONB
);

-- Per-model breakdown for each snapshot (FK → usage_snapshots)
CREATE TABLE IF NOT EXISTS model_usage (
    id BIGSERIAL PRIMARY KEY,
    snapshot_id BIGINT REFERENCES usage_snapshots(id) ON DELETE CASCADE,
    api_endpoint VARCHAR(255) NOT NULL,
    model_name VARCHAR(255) NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    reasoning_tokens BIGINT NOT NULL DEFAULT 0,
    cached_tokens BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    estimated_cost_usd DECIMAL(18, 6) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Daily aggregated statistics (upserted each sync cycle)
CREATE TABLE IF NOT EXISTS daily_stats (
    id BIGSERIAL PRIMARY KEY,
    stat_date DATE NOT NULL UNIQUE,
    total_requests INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    estimated_cost_usd DECIMAL(18, 6) DEFAULT 0,
    breakdown JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Model pricing configuration (pattern matching)
CREATE TABLE IF NOT EXISTS model_pricing (
    id BIGSERIAL PRIMARY KEY,
    model_pattern VARCHAR(255) NOT NULL UNIQUE,
    input_price_per_million DECIMAL(10, 4) NOT NULL,
    output_price_per_million DECIMAL(10, 4) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================
-- Credential Tables
-- =====================

-- Single-row table: latest cumulative credential usage from CLIProxy
CREATE TABLE IF NOT EXISTS credential_usage_summary (
    id SERIAL PRIMARY KEY,
    credentials JSONB NOT NULL DEFAULT '[]'::jsonb,
    api_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    total_credentials INTEGER DEFAULT 0,
    total_api_keys INTEGER DEFAULT 0,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-day delta credential and API key usage
CREATE TABLE IF NOT EXISTS credential_daily_stats (
    id SERIAL PRIMARY KEY,
    stat_date DATE NOT NULL UNIQUE,
    credentials JSONB NOT NULL DEFAULT '[]'::jsonb,
    api_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    total_credentials INTEGER DEFAULT 0,
    total_api_keys INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================
-- Indexes
-- =====================

CREATE INDEX IF NOT EXISTS idx_usage_snapshots_collected_at
    ON usage_snapshots(collected_at DESC);

CREATE INDEX IF NOT EXISTS idx_model_usage_snapshot_id
    ON model_usage(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_model_usage_model_name
    ON model_usage(model_name);

CREATE INDEX IF NOT EXISTS idx_daily_stats_date
    ON daily_stats(stat_date DESC);

CREATE INDEX IF NOT EXISTS idx_credential_daily_stats_date
    ON credential_daily_stats(stat_date);

-- =====================
-- PostgREST Access Control
-- =====================
-- web_anon: anonymous read-only role used by PostgREST (frontend queries)
-- The cliproxy user (authenticator) switches to web_anon for each request

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'web_anon') THEN
        CREATE ROLE web_anon NOLOGIN;
    END IF;
END
$$;

-- Allow the authenticator (cliproxy) to assume the web_anon role
GRANT web_anon TO cliproxy;

-- Grant schema usage and SELECT on all tables to web_anon
GRANT USAGE ON SCHEMA public TO web_anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO web_anon;

-- Ensure future tables also get SELECT granted (run as superuser)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO web_anon;

-- =====================
-- Skill Tracking Tables
-- =====================

CREATE TABLE IF NOT EXISTS skill_runs (
    id                  BIGSERIAL PRIMARY KEY,
    machine_id          TEXT        NOT NULL DEFAULT '',
    sqlite_id           INTEGER,
    skill_name          TEXT        NOT NULL,
    session_id          TEXT        NOT NULL,
    triggered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trigger_type        TEXT        NOT NULL DEFAULT 'explicit',
    arguments           TEXT,
    tokens_used         INTEGER     NOT NULL DEFAULT 0,
    output_tokens       INTEGER     NOT NULL DEFAULT 0,
    tool_calls          INTEGER     NOT NULL DEFAULT 0,
    duration_ms         INTEGER     NOT NULL DEFAULT 0,
    skill_version_hash  TEXT,
    model               TEXT,
    is_skeleton         BOOLEAN     NOT NULL DEFAULT FALSE,
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    project_dir         TEXT        NOT NULL DEFAULT '',
    CONSTRAINT uq_skill_run_source UNIQUE NULLS NOT DISTINCT (machine_id, sqlite_id, session_id, skill_name)
);

CREATE TABLE IF NOT EXISTS skill_daily_stats (
    id                  BIGSERIAL PRIMARY KEY,
    stat_date           DATE        NOT NULL,
    skill_name          TEXT        NOT NULL,
    machine_id          TEXT        NOT NULL DEFAULT '',
    run_count           INTEGER     NOT NULL DEFAULT 0,
    total_tokens        BIGINT      NOT NULL DEFAULT 0,
    total_output_tokens BIGINT      NOT NULL DEFAULT 0,
    total_duration_ms   BIGINT      NOT NULL DEFAULT 0,
    avg_tokens          NUMERIC(10,2) GENERATED ALWAYS AS (
                            CASE WHEN run_count > 0 THEN total_tokens::numeric / run_count ELSE 0 END
                        ) STORED,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_skill_daily UNIQUE (stat_date, skill_name, machine_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_runs_name      ON skill_runs(skill_name);
CREATE INDEX IF NOT EXISTS idx_skill_runs_triggered ON skill_runs(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_runs_machine   ON skill_runs(machine_id);
CREATE INDEX IF NOT EXISTS idx_skill_daily_date     ON skill_daily_stats(stat_date DESC);

GRANT SELECT ON skill_runs        TO web_anon;
GRANT SELECT ON skill_daily_stats TO web_anon;

-- =====================
-- Seed Data
-- =====================

-- Initialize the single-row credential summary (id=1 always)
INSERT INTO credential_usage_summary (id, credentials, api_keys, total_credentials, total_api_keys)
VALUES (1, '[]', '[]', 0, 0)
ON CONFLICT (id) DO NOTHING;
