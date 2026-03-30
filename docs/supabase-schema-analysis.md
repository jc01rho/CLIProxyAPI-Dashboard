# CLIProxy Collector Supabase Schema Analysis

## 1. 필수 테이블 목록 (7개)

Collector가 `db_client.table()`로 접근하는 모든 테이블:

| 테이블 | 용도 | INSERT/UPSERT | SELECT | DELETE |
|--------|------|---------------|--------|--------|
| `app_logs` | 운영 로그 저장 | ✅ UPSERT/INSERT | ✅ | ✅ |
| `usage_snapshots` | cumulative 스냅샷 | ✅ INSERT | ✅ | - |
| `model_usage` | 모델별 사용량 | ✅ INSERT | - | - |
| `daily_stats` | 일일 통계 aggregation | ✅ UPSERT | ✅ | - |
| `skill_runs` | 스킬 실행 기록 | ✅ UPSERT | - | - |
| `skill_daily_stats` | 스킬 일일 통계 | ✅ UPSERT | - | - |
| `admin_sessions` | 관리자 세션 | ✅ INSERT | ✅ | ✅ |

---

## 2. app_logs 테이블 상세 분석

### 2.1 main.py INSERT 컬럼 (실제 사용)

`_normalize_app_log_event()` 함수에서 생성하는 dict:

```python
{
    "event_uid": str | None,        # upsert conflict key
    "logged_at": ISO8601 UTC,       # NOT NULL
    "source": str,                  # default: 'collector'
    "category": str,                # default: 'system'
    "severity": str,                # default: 'info'
    "title": str | None,
    "message": str,                 # NOT NULL (필수)
    "details": dict | list | None,  # JSONB
    "session_id": str | None,
    "machine_id": str | None,
    "project_dir": str | None,
    "created_at": ISO8601 UTC,      # NOT NULL default NOW()
}
```

### 2.2 Supabase 최소 스키마 (바로 실행 가능)

```sql
-- app_logs table for operational log viewer
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

-- 필수 인덱스
CREATE INDEX IF NOT EXISTS idx_app_logs_logged_at ON app_logs(logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_logged_at_id_desc ON app_logs(logged_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_logs_event_uid ON app_logs(event_uid);

-- PostgREST 읽기 권한 (Supabase anon key 사용 시)
GRANT SELECT ON app_logs TO anon;
-- 또는 서비스 롤 사용 시
GRANT ALL ON app_logs TO service_role;
```

### 2.3 Supabase 특이사항

- Supabase는 기본적으로 `anon` role 사용 → `GRANT SELECT` 필요
- `service_role` 사용 시 → `GRANT ALL` 또는 스키마 생성 시 자동 권한
- JSONB 컬럼 `details`는 db.py에서 `psycopg2.extras.Json` wrapping 처리

---

## 3. 전체 Supabase 실행 스키마 (모든 테이블)

### 3.1 usage_snapshots

```sql
CREATE TABLE IF NOT EXISTS usage_snapshots (
    id BIGSERIAL PRIMARY KEY,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw_data JSONB,
    total_requests BIGINT NOT NULL DEFAULT 0,
    success_count BIGINT NOT NULL DEFAULT 0,
    failure_count BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    cumulative_cost_usd NUMERIC(20, 6) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_usage_snapshots_collected_at ON usage_snapshots(collected_at DESC);
GRANT SELECT ON usage_snapshots TO anon;
```

### 3.2 model_usage

```sql
CREATE TABLE IF NOT EXISTS model_usage (
    id BIGSERIAL PRIMARY KEY,
    snapshot_id BIGINT NOT NULL REFERENCES usage_snapshots(id),
    model_name TEXT NOT NULL,
    api_endpoint TEXT NOT NULL,
    request_count BIGINT NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    reasoning_tokens BIGINT NOT NULL DEFAULT 0,
    cached_tokens BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(20, 6) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_model_usage_snapshot_id ON model_usage(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_model_usage_model_name ON model_usage(model_name);
GRANT SELECT ON model_usage TO anon;
```

### 3.3 daily_stats

```sql
CREATE TABLE IF NOT EXISTS daily_stats (
    id BIGSERIAL PRIMARY KEY,
    stat_date DATE NOT NULL UNIQUE,
    total_requests BIGINT NOT NULL DEFAULT 0,
    success_count BIGINT NOT NULL DEFAULT 0,
    failure_count BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(20, 6) NOT NULL DEFAULT 0,
    breakdown JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_stats_stat_date ON daily_stats(stat_date);
CREATE INDEX IF NOT EXISTS idx_daily_stats_stat_date ON daily_stats(stat_date DESC);
GRANT SELECT ON daily_stats TO anon;
```

### 3.4 skill_runs

```sql
CREATE TABLE IF NOT EXISTS skill_runs (
    id BIGSERIAL PRIMARY KEY,
    event_uid TEXT,
    machine_id TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    sqlite_id INTEGER,
    tool_use_id TEXT,
    skill_name TEXT NOT NULL,
    session_id TEXT NOT NULL,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trigger_type TEXT NOT NULL DEFAULT 'explicit',
    status TEXT NOT NULL DEFAULT 'success',
    error_type TEXT,
    error_message TEXT,
    attempt_no INTEGER NOT NULL DEFAULT 1,
    arguments TEXT,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    tool_calls INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(20, 6) NOT NULL DEFAULT 0,
    skill_version_hash TEXT,
    model TEXT,
    is_skeleton BOOLEAN NOT NULL DEFAULT FALSE,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    project_dir TEXT NOT NULL DEFAULT '',
    CONSTRAINT uq_skill_run_source UNIQUE NULLS NOT DISTINCT (machine_id, sqlite_id, session_id, skill_name)
);

CREATE INDEX IF NOT EXISTS idx_skill_runs_triggered ON skill_runs(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_runs_event_uid ON skill_runs(event_uid);
CREATE INDEX IF NOT EXISTS idx_skill_runs_status ON skill_runs(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_runs_event_uid ON skill_runs(event_uid) WHERE event_uid IS NOT NULL;
GRANT SELECT ON skill_runs TO anon;
```

### 3.5 skill_daily_stats

```sql
CREATE TABLE IF NOT EXISTS skill_daily_stats (
    id BIGSERIAL PRIMARY KEY,
    stat_date DATE NOT NULL,
    skill_name TEXT NOT NULL,
    machine_id TEXT NOT NULL DEFAULT '',
    run_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    total_duration_ms BIGINT NOT NULL DEFAULT 0,
    total_tool_calls BIGINT NOT NULL DEFAULT 0,
    total_cost_usd NUMERIC(20, 6) NOT NULL DEFAULT 0,
    avg_tokens INTEGER NOT NULL DEFAULT 0,
    avg_duration_ms INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_skill_daily UNIQUE (stat_date, skill_name, machine_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_daily_date ON skill_daily_stats(stat_date DESC);
GRANT SELECT ON skill_daily_stats TO anon;
```

### 3.6 admin_sessions

```sql
CREATE TABLE IF NOT EXISTS admin_sessions (
    id BIGSERIAL PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    remember_me BOOLEAN NOT NULL DEFAULT FALSE,
    created_ip TEXT,
    user_agent TEXT,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
GRANT SELECT ON admin_sessions TO anon;
```

---

## 4. Supabase 설정 순서

1. Supabase Dashboard → SQL Editor 열기
2. 위 스크립트 순서대로 실행 (테이블 생성)
3. RLS (Row Level Security) 설정 여부 확인:
   - `anon` role로만 SELECT → RLS 정책 불필요
   - 제한된 접근 필요 → RLS 정책 추가
4. Supabase 연결 확인:
   - `DATABASE_URL` = Supabase connection string (postgres://...)
   - Collector 시작 → migrations 자동 실행 확인

---

## 5. PGRST205 에러 원인

- **PostgREST 에러 코드 PGRST205**: "The table does not exist"
- Supabase 프로젝트에 `app_logs` 테이블이 없어서 발생
- 위 `app_logs` CREATE TABLE SQL을 Supabase SQL Editor에서 실행하면 해결

---

## 6. 파일 참조

- 스키마 정의: `init-db/schema.sql`
- Migration 파일: `collector/migrations/*.sql`
- 실제 INSERT 로직: `collector/main.py` → `_normalize_app_log_event()`
- JSONB 처리: `collector/db.py` → `JSONB_COLUMNS` dict