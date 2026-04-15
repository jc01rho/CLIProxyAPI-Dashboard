# COLLECTOR KNOWLEDGE BASE

> 상위 문서: [../AGENTS.md](../AGENTS.md)

## OVERVIEW

`collector/`는 Python Flask API, scheduler, usage snapshot 수집, admin 세션, DB migration을 함께 가진 대시보드 백엔드다.

## STRUCTURE

```text
collector/
├── main.py                # Flask app + scheduler + collector jobs
├── db.py                  # PostgreSQL query builder / migrations
├── credential_stats_sync.py
├── migrations/
│   └── 000*.sql
└── test_main_retention.py # unittest 기반 회귀 테스트
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 수집 주기/로그인/health | `main.py` | `/api/collector/*` routes |
| DB write/read 패턴 | `db.py` | Supabase-like fluent query |
| credential 통계 보정 | `credential_stats_sync.py` | 스냅샷 외 별도 동기화 |
| 스키마 마이그레이션 | `migrations/` | 순번 증가 유지 |
| retention/compaction 회귀 | `test_main_retention.py` | unittest + dependency stub |

## CONVENTIONS

- 환경변수 기본값과 scheduler 간격은 `main.py` 상단 상수에서 관리한다.
- JSONB 컬럼 write 처리는 `db.py`의 wrapper를 거친다.
- migration 파일은 widening/additive 변경 위주로 작성한다.
- 테스트는 `unittest` 스타일이며, 외부 의존성은 stub로 치환한다.

## ANTI-PATTERNS

- schema 변경 시 `init-db/schema.sql` 갱신을 빼먹지 않는다.
- 로컬/수파베이스 분기 로직을 여러 파일에 흩뿌리지 않는다.
- gateway HTML 오류, retention, compaction 로직을 테스트 없이 손대지 않는다.
