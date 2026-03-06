ALTER TABLE usage_snapshots
    ALTER COLUMN cumulative_cost_usd TYPE DECIMAL(18, 6);

ALTER TABLE model_usage
    ALTER COLUMN estimated_cost_usd TYPE DECIMAL(18, 6);

ALTER TABLE daily_stats
    ALTER COLUMN estimated_cost_usd TYPE DECIMAL(18, 6);
