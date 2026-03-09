-- Expand cost precision and counter capacity to prevent overflow on high-volume deployments

-- Cost columns: DECIMAL(10,6) -> DECIMAL(20,6)
ALTER TABLE usage_snapshots
    ALTER COLUMN cumulative_cost_usd TYPE NUMERIC(20, 6);

ALTER TABLE model_usage
    ALTER COLUMN estimated_cost_usd TYPE NUMERIC(20, 6);

ALTER TABLE daily_stats
    ALTER COLUMN estimated_cost_usd TYPE NUMERIC(20, 6);

-- Request counters: INTEGER -> BIGINT
ALTER TABLE usage_snapshots
    ALTER COLUMN total_requests TYPE BIGINT,
    ALTER COLUMN success_count TYPE BIGINT,
    ALTER COLUMN failure_count TYPE BIGINT;

ALTER TABLE model_usage
    ALTER COLUMN request_count TYPE BIGINT;

ALTER TABLE daily_stats
    ALTER COLUMN total_requests TYPE BIGINT,
    ALTER COLUMN success_count TYPE BIGINT,
    ALTER COLUMN failure_count TYPE BIGINT;
