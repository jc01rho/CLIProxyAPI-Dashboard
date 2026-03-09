-- Enhance skill telemetry with status, idempotency and cost metrics

ALTER TABLE skill_runs
    ADD COLUMN IF NOT EXISTS event_uid TEXT,
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS tool_use_id TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'success',
    ADD COLUMN IF NOT EXISTS error_type TEXT,
    ADD COLUMN IF NOT EXISTS error_message TEXT,
    ADD COLUMN IF NOT EXISTS attempt_no INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(20, 6) NOT NULL DEFAULT 0;

ALTER TABLE skill_daily_stats
    ADD COLUMN IF NOT EXISTS success_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_tool_calls BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_cost_usd NUMERIC(20, 6) NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_runs_event_uid
    ON skill_runs(event_uid)
    WHERE event_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_skill_runs_event_uid
    ON skill_runs(event_uid);

CREATE INDEX IF NOT EXISTS idx_skill_runs_status
    ON skill_runs(status);

CREATE INDEX IF NOT EXISTS idx_skill_runs_source
    ON skill_runs(source);

GRANT SELECT ON skill_runs TO web_anon;
GRANT SELECT ON skill_daily_stats TO web_anon;
