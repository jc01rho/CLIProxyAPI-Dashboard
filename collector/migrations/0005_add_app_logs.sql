-- Add app_logs table for operational log viewer

CREATE TABLE IF NOT EXISTS app_logs (
    id BIGSERIAL PRIMARY KEY,
    event_uid TEXT,
    logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source TEXT NOT NULL DEFAULT 'collector',
    category TEXT NOT NULL DEFAULT 'system',
    severity TEXT NOT NULL DEFAULT 'info',
    title TEXT,
    message TEXT NOT NULL,
    details JSONB,
    session_id TEXT,
    machine_id TEXT,
    project_dir TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_logs_logged_at
    ON app_logs(logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_logs_severity_logged_at
    ON app_logs(severity, logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_logs_category_logged_at
    ON app_logs(category, logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_logs_source_logged_at
    ON app_logs(source, logged_at DESC);

DROP INDEX IF EXISTS uq_app_logs_event_uid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_logs_event_uid
    ON app_logs(event_uid);

GRANT SELECT ON app_logs TO web_anon;
