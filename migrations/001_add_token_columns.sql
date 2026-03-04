-- Migration: Add reasoning_tokens and cached_tokens to model_usage table
-- Run this SQL if you have an existing database and want to add the new token tracking fields

-- Add reasoning_tokens column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'model_usage' AND column_name = 'reasoning_tokens'
    ) THEN
        ALTER TABLE model_usage ADD COLUMN reasoning_tokens BIGINT NOT NULL DEFAULT 0;
    END IF;
END $$;

-- Add cached_tokens column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'model_usage' AND column_name = 'cached_tokens'
    ) THEN
        ALTER TABLE model_usage ADD COLUMN cached_tokens BIGINT NOT NULL DEFAULT 0;
    END IF;
END $$;

-- Verify the changes
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'model_usage'
ORDER BY ordinal_position;
