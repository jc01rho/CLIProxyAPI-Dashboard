# COLLECTOR SERVICE

Python data collection service. Polls CLIProxy Management API, calculates deltas, stores in Supabase.

## STRUCTURE

```
collector/
├── main.py           # Flask server, scheduler, delta calculation
├── rate_limiter.py   # RateLimiter class, window calculations
├── requirements.txt  # Flask, supabase, APScheduler, waitress
└── Dockerfile        # Python 3.11 slim
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add API endpoint | `main.py:api_bp` | Blueprint at `/api/collector/` |
| Modify delta logic | `main.py:store_usage_data()` | Lines 275-625 |
| Change pricing | `main.py:DEFAULT_PRICING` | Also fetches llm-prices.com |
| Rate limit strategies | `rate_limiter.py:_process_config()` | daily/weekly/rolling |
| Reset anchor logic | `rate_limiter.py:102-108` | Manual reset vs natural window |

## CONVENTIONS

### Delta Calculation Algorithm
1. Fetch current cumulative from CLIProxy
2. Compare with previous snapshot (2nd latest in DB)
3. If `current < previous`: restart detected, use `current` as delta
4. Aggregate into `daily_stats.breakdown` JSON

### False Start Detection
- New model appearing with >$10 cost spike: **skip it**
- Prevents cumulative history from inflating daily stats
- Logged as "False Start detected" warning

### Rate Limit Window Logic
- `daily`: Reset at local midnight (TIMEZONE_OFFSET_HOURS)
- `weekly`: Reset Monday 00:00 local
- `rolling`: Sliding window of `window_minutes`
- `reset_anchor_timestamp`: Manual reset overrides natural boundary

### Database Upserts
- `daily_stats`: upsert on `stat_date`
- `rate_limit_status`: upsert on `config_id`
- Cumulative cost tracked in `usage_snapshots.cumulative_cost_usd`

## ANTI-PATTERNS

- **NEVER** subtract without checking for restart (negative delta)
- **NEVER** store pricing in DB without `_default` fallback
- **AVOID** blocking calls in scheduler thread (use threading.Thread for triggers)
- **AVOID** raw SQL - always use supabase client

## COMMON ISSUES

**"Restart detected" logs flooding:**
- Normal if CLIProxy restarts frequently
- Check CLIProxy stability, not collector bug

**False start skipping legitimate usage:**
- Threshold is $10 cost spike AND delta == current
- Adjust `>10` check in `store_usage_data()` if needed

**Rate limits showing 100% after reset:**
- `reset_anchor_timestamp` must be newer than calculated window start
- Check `_process_config()` logic for anchor comparison
