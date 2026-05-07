-- Remove obsolete database-backed application logs.
-- Operational logs are emitted to stdout/stderr instead of persisted in Supabase/Postgres.
DROP TABLE IF EXISTS app_logs CASCADE;
