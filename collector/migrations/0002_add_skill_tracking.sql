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
