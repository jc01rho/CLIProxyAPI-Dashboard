-- Add composite index for stable app_logs pagination by logged_at + id
CREATE INDEX IF NOT EXISTS idx_app_logs_logged_at_id_desc
    ON app_logs(logged_at DESC, id DESC);
