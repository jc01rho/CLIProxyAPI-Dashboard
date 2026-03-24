# Implementation Plan: End-to-End Input/Output Token Separation

## Executive Summary

Based on codebase analysis, the CLIProxyAPI-Dashboard already has **partial support** for input/output token separation. This plan details the minimal changes needed to expose these values throughout the dashboard at the daily aggregation level.

---

## Current State Analysis

### ✅ Already Has Input/Output Token Support:

| Component | Status | Evidence |
|-----------|--------|----------|
| `model_usage` table | ✅ Complete | Columns: `input_tokens`, `output_tokens`, `reasoning_tokens`, `cached_tokens` (schema.sql:29-32) |
| `breakdown` JSONB in `daily_stats` | ✅ Complete | Per-model breakdown already has input_tokens, output_tokens (main.py:1286, 1398) |
| `skill_runs` table | ✅ Complete | Columns: `tokens_used`, `output_tokens` (schema.sql:172-173) |
| `skill_daily_stats` table | ✅ Complete | Columns: `total_tokens`, `total_output_tokens` (schema.sql:194-195) |
| Frontend token type config | ✅ Complete | TOKEN_TYPES array in Dashboard.jsx:207-212 |

### ❌ Missing Input/Output at Daily Aggregation Level:

| Component | Status | Evidence |
|-----------|--------|----------|
| `daily_stats` table (top-level) | ❌ Only `total_tokens` | schema.sql:45 - missing `input_tokens`/`output_tokens` columns |
| `usage_snapshots` table | ❌ Only `total_tokens` | schema.sql:17 - missing `input_tokens`/`output_tokens` columns |

---

## Implementation Plan

### Phase 1: Database Schema Changes

#### 1.1 Schema File: `init-db/schema.sql`

**Change:** Add `input_tokens` and `output_tokens` columns to `daily_stats` table

```sql
-- Add after total_tokens column (line 45)
input_tokens BIGINT NOT NULL DEFAULT 0,
output_tokens BIGINT NOT NULL DEFAULT 0,
```

**Rationale:** This is a widening change (ADD only, no MODIFY) - safe for existing data.

#### 1.2 Migration File: `collector/migrations/0008_add_daily_tokens_separation.sql`

**Purpose:** Add columns to existing database without recreating table

```sql
ALTER TABLE daily_stats 
ADD COLUMN IF NOT EXISTS input_tokens BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS output_tokens BIGINT NOT NULL DEFAULT 0;
```

**Rollback (if needed):**
```sql
ALTER TABLE daily_stats 
DROP COLUMN IF EXISTS input_tokens,
DROP COLUMN IF EXISTS output_tokens;
```

---

### Phase 2: Collector Changes

#### 2.1 File: `collector/main.py`

**Location:** Function `store_usage_data()`, around line 1445-1453

**Change:** Add `input_tokens` and `output_tokens` to the daily_data upsert

Current code (line 1445-1453):
```python
daily_data = {
    'stat_date': today_iso,
    'total_requests': final_requests,
    'success_count': int(existing_daily.get('success_count', 0) or 0) + inc_success,
    'failure_count': int(existing_daily.get('failure_count', 0) or 0) + inc_failure,
    'total_tokens': final_tokens,
    'estimated_cost_usd': final_cost,
    'breakdown': existing_breakdown
}
```

New code:
```python
# Calculate input/output totals from breakdown (already available)
total_input_from_breakdown = sum(m.get('input_tokens', 0) for m in existing_breakdown.get('models', {}).values())
total_output_from_breakdown = sum(m.get('output_tokens', 0) for m in existing_breakdown.get('models', {}).values())

daily_data = {
    'stat_date': today_iso,
    'total_requests': final_requests,
    'success_count': int(existing_daily.get('success_count', 0) or 0) + inc_success,
    'failure_count': int(existing_daily.get('failure_count', 0) or 0) + inc_failure,
    'total_tokens': final_tokens,
    'input_tokens': total_input_from_breakdown,
    'output_tokens': total_output_from_breakdown,
    'estimated_cost_usd': final_cost,
    'breakdown': existing_breakdown
}
```

**Rationale:** The breakdown already contains per-model input/output tokens (lines 1286, 1398). We just need to aggregate them at the daily level.

---

### Phase 3: Frontend Changes

#### 3.1 File: `frontend/src/App.jsx`

**Location 1:** Line 922-923 - Fetch from daily_stats
**Change:** Add `input_tokens` and `output_tokens` to select

Current:
```javascript
select: 'stat_date,total_requests,total_tokens,success_count,failure_count,estimated_cost_usd,breakdown',
```

New:
```javascript
select: 'stat_date,total_requests,total_tokens,input_tokens,output_tokens,success_count,failure_count,estimated_cost_usd,breakdown',
```

**Location 2:** Lines 930-936 - Parse daily stats row
**Change:** Include input_tokens, output_tokens in parsed object

Current:
```javascript
dailyStatsFromDB[row.stat_date] = {
    total_requests: row.total_requests || 0,
    total_tokens: row.total_tokens || 0,
    success_count: row.success_count || 0,
    failure_count: row.failure_count || 0,
    estimated_cost_usd: parseFloat(row.estimated_cost_usd) || 0
}
```

New:
```javascript
dailyStatsFromDB[row.stat_date] = {
    total_requests: row.total_requests || 0,
    total_tokens: row.total_tokens || 0,
    input_tokens: row.input_tokens || 0,
    output_tokens: row.output_tokens || 0,
    success_count: row.success_count || 0,
    failure_count: row.failure_count || 0,
    estimated_cost_usd: parseFloat(row.estimated_cost_usd) || 0
}
```

#### 3.2 File: `frontend/src/components/Dashboard.jsx`

**Location 1:** Lines 356-358 - Calculate totals
**Change:** Add input/output token totals

Current:
```javascript
const totalRequests = filteredDailyStats.reduce((sum, d) => sum + (d.total_requests || 0), 0)
const totalTokens = filteredDailyStats.reduce((sum, d) => sum + (d.total_tokens || 0), 0)
const successCount = filteredDailyStats.reduce((sum, d) => sum + (d.success_count || 0), 0)
const failureCount = filteredDailyStats.reduce((sum, d) => sum + (d.failure_count || 0), 0)
```

New:
```javascript
const totalRequests = filteredDailyStats.reduce((sum, d) => sum + (d.total_requests || 0), 0)
const totalTokens = filteredDailyStats.reduce((sum, d) => sum + (d.total_tokens || 0), 0)
const totalInputTokens = filteredDailyStats.reduce((sum, d) => sum + (d.input_tokens || 0), 0)
const totalOutputTokens = filteredDailyStats.reduce((sum, d) => sum + (d.output_tokens || 0), 0)
const successCount = filteredDailyStats.reduce((sum, d) => sum + (d.success_count || 0), 0)
const failureCount = filteredDailyStats.reduce((sum, d) => sum + (d.failure_count || 0), 0)
```

**Location 2:** Lines 1040-1048 - Display in StatCard
**Change:** Update the TOTAL TOKENS card to show input/output breakdown

```jsx
<StatCard
    label="TOTAL TOKENS"
    value={formatNumber(totalTokens)}
    meta={`Input: ${formatNumber(totalInputTokens)} · Output: ${formatNumber(totalOutputTokens)}`}
    icon={<PieGraph />}
    sparklineData={sparklineData}
    dataKey="tokens"
    stroke="#f59e0b"
/>
```

**Location 3:** Token trend chart data (lines 556-596)
**Change:** Already works! The `tokenTrendData` computation reads from `point.models[model].input_tokens` which comes from breakdown. No change needed.

---

### Phase 4: Optional Enhancement (usage_snapshots)

If you want input/output tokens at the snapshot level too:

#### 4.1 Schema: Add to `usage_snapshots`
```sql
ALTER TABLE usage_snapshots
ADD COLUMN IF NOT EXISTS input_tokens BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS output_tokens BIGINT NOT NULL DEFAULT 0;
```

#### 4.2 Collector: Update snapshot insertion (around line 1035)
```python
snapshot_data = {
    'raw_data': data,
    'total_requests': current_requests,
    'success_count': current_success,
    'failure_count': current_failure,
    'total_tokens': current_tokens,
    'input_tokens': sum(input_tok for r in model_records),  # Add this
    'output_tokens': sum(output_tok for r in model_records), # Add this
}
```

---

## Migration & Rollout Implications

### Fresh Install vs. Existing DB

| Scenario | Action Required |
|----------|-----------------|
| Fresh install | `init-db/schema.sql` updated - auto-applies on container init |
| Existing DB | Run migration `0008_add_daily_tokens_separation.sql` manually or via collector startup |

### Collector Startup Migration Logic

The collector already has migration runner in `db.py`. Add the new migration file with sequential numbering.

### Minimal-Diff Path

This implementation is **minimal-diff** because:

1. **No schema removal** - only ADD columns (backward compatible)
2. **No data transformation** - breakdown JSONB already has the data, we just aggregate it
3. **Frontend fallback** - if daily_stats.input_tokens is 0, breakdown still has the values
4. **No breaking changes** - existing queries work, new fields are additive

### Verification Steps

After deployment, verify:

```sql
-- Check new columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'daily_stats' 
AND column_name IN ('input_tokens', 'output_tokens');

-- Check values populated (after collector runs)
SELECT stat_date, total_tokens, input_tokens, output_tokens 
FROM daily_stats 
ORDER BY stat_date DESC 
LIMIT 5;
```

---

## File-by-File Summary

| File | Change Type | Lines | Complexity |
|------|-------------|-------|------------|
| `init-db/schema.sql` | ADD columns | ~47-48 | Trivial |
| `collector/migrations/0008_*.sql` | New file | ~5 | Trivial |
| `collector/main.py` | MODIFY | 1445-1460 | Low |
| `frontend/src/App.jsx` | MODIFY | 922, 930-936 | Low |
| `frontend/src/components/Dashboard.jsx` | MODIFY | 356-365, 1040-1048 | Low |

---

## Testing Plan

### Backend Tests

```bash
# 1. Verify migration runs without error
docker compose logs collector | grep -i migration

# 2. Trigger manual sync
curl -X POST http://localhost:8417/api/collector/trigger

# 3. Check database values
docker exec -it cliproxy-dashboard-postgres-1 psql -U cliproxy -c "SELECT stat_date, total_tokens, input_tokens, output_tokens FROM daily_stats ORDER BY stat_date DESC LIMIT 3;"
```

### Frontend Tests

1. Load dashboard - TOTAL TOKENS card should show Input/Output breakdown
2. Check token trend chart - should still work (reads from breakdown)
3. Date range selection - should aggregate correctly
4. Dark/light mode toggle - no impact

### Build Commands

```bash
# Backend - no build needed (Python)
# Just rebuild collector image
docker compose build collector

# Frontend - rebuild
cd CLIProxyAPI-Dashboard/frontend
npm run build
```

---

## Rollback Plan

If issues occur:

1. **Frontend rollback:** Rebuild with old image - no schema dependency
2. **Collector rollback:** Rebuild with old image - new columns are just unused
3. **Migration rollback:** Run DROP COLUMN commands (data preserved in breakdown JSONB)

---

## Conclusion

The dashboard already has the data infrastructure for input/output token separation. The implementation adds:

1. Two new columns to `daily_stats` table
2. Aggregation logic in collector to populate them
3. Frontend display updates

This is a **low-risk, additive change** that leverages existing breakdown data without requiring any migration of existing information.