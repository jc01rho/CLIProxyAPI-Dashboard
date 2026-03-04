-- Add reasoning_tokens and cached_tokens columns to model_usage
-- These columns were added to support CLIProxy's extended token tracking
ALTER TABLE model_usage ADD COLUMN IF NOT EXISTS reasoning_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE model_usage ADD COLUMN IF NOT EXISTS cached_tokens BIGINT NOT NULL DEFAULT 0;
