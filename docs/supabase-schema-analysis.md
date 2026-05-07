# CLIProxy Collector Supabase Schema Analysis

## 필수 테이블 목록

Collector가 현재 DB에 직접 접근하는 주요 테이블입니다. `app_logs`는 제거되었고 운영 로그는 컨테이너/stdout 로그로만 남습니다.

| 테이블 | 용도 | 주요 작성 경로 | 주요 조회 경로 |
|--------|------|---------------|---------------|
| `request_events` | usage-queue/Redis/management detail 기반 요청 이벤트와 aggregate marker | `collector/main.py:_flush_request_event_upload_buffer()` | `/api/collector/request_events/*`, dashboard aggregate fallback |
| `skill_runs` | OpenCode skill 실행 이벤트 | `/api/collector/skill-events` | skill usage endpoints |
| `skill_daily_stats` | skill 일일 집계 | skill compaction path | skill usage endpoints |
| `admin_sessions` | 관리자 로그인 세션 | auth login/touch/logout | auth/session middleware |
| `credential_usage_summary` | legacy management credential summary | `credential_stats_sync.py` when management polling is enabled | credential stats API/fallback |
| `credential_daily_stats` | legacy credential daily delta | `credential_stats_sync.py` when management polling is enabled | credential daily/hourly APIs/fallback |
| `usage_snapshots` | legacy `/v0/management/usage` cumulative snapshots | `store_usage_data()` when management polling is enabled | legacy fallback/retention/compaction |
| `model_usage` | legacy per-model snapshot rows | `store_usage_data()` when management polling is enabled | legacy fallback/compaction |
| `daily_stats` | legacy daily aggregate | `store_usage_data()` when management polling is enabled | legacy fallback |
| `model_pricing` | optional local pricing overrides | manual/seeded DB data | pricing lookup |

## app_logs 제거

`app_logs`는 더 이상 신규 스키마에서 생성되지 않습니다. 기존 설치는 migration `0012_drop_app_logs.sql`이 다음 작업을 수행합니다.

```sql
DROP TABLE IF EXISTS app_logs CASCADE;
```

삭제 이유:

- Dashboard frontend가 DB `app_logs`를 표시하지 않습니다.
- Supabase Free egress/storage 환경에서 운영 로그를 DB row로 저장하는 것은 불필요한 write/retention 비용을 만듭니다.
- Collector 운영 이벤트는 Python logger를 통해 stdout/stderr로 출력되므로 Docker/Kubernetes/hosting log pipeline에서 확인할 수 있습니다.

## usage_snapshots / model_usage / daily_stats가 비어 있을 수 있는 이유

이 세 테이블은 현재 주 경로가 아니라 legacy management polling 경로입니다.

### Legacy management polling 경로

```text
run_full_sync_once()
  -> _run_management_sync()
  -> fetch_usage_data()              # Plus /v0/management/usage
  -> store_usage_data()
       -> usage_snapshots INSERT
       -> model_usage INSERT
       -> daily_stats UPSERT
```

이 경로는 `USAGE_SYNC_MODE=management`이거나 management polling이 활성화된 경우에만 의미가 있습니다. 또한 DB write는 `MODEL_USAGE_UPLOAD_INTERVAL_SECONDS` upload window에 의해 지연/집계됩니다.

### 현재 기본 request-events 경로

```text
run_full_sync_once()
  -> _usage_queue_sync_once() / _redis_queue_sync_once()
  -> _persist_queue_payloads()
  -> _flush_request_event_upload_buffer()
       -> request_events UPSERT
       -> request_events aggregate marker rows

frontend
  -> /api/collector/request_events/aggregate
  -> RequestEventsPanel / Usage Trends / Cost Analysis / Credential Usage Statistics
```

따라서 `request_events`가 채워지고 dashboard가 정상 표시된다면 `usage_snapshots`, `model_usage`, `daily_stats`가 비어 있는 것은 request-events 기반 운영에서는 예상 가능한 상태입니다.

반대로 `USAGE_SYNC_MODE=management`인데도 세 테이블이 계속 비어 있으면 다음을 의심해야 합니다.

- Plus legacy `/v0/management/usage` 호출 실패
- `MODEL_USAGE_UPLOAD_INTERVAL_SECONDS` upload window 대기 중
- `store_usage_data()` 실패
- DB 권한/스키마 불일치
