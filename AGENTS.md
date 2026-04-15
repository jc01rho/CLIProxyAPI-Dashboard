# DASHBOARD KNOWLEDGE BASE

**Updated:** 2026-04-15
**Commit:** 9be69e5f
**Branch:** master

## OVERVIEW

`CLIProxyAPI-Dashboard`는 collector(Flask + scheduler), local Postgres/PostgREST stack, React dashboard frontend를 함께 유지한다. 로컬 DB 모드와 Supabase 모드를 모두 지원한다.

## STRUCTURE

```text
CLIProxyAPI-Dashboard/
├── collector/         # Python collector + admin/auth + migrations
├── frontend/          # React 18 + Vite dashboard
├── init-db/           # schema.sql / seed.sql
├── docs/              # 운영/계산 관련 문서
├── plugin/            # tracker plugin mirror/submodule
└── docker-compose.yml # postgres/postgrest/collector/frontend orchestration
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 수집 주기/로그인/API | `collector/main.py` | Flask routes + scheduler |
| DB client/SQL 작성 | `collector/db.py` | Supabase-like query builder |
| 스키마 변경 | `init-db/schema.sql`, `collector/migrations/` | 둘 다 갱신 |
| 시각화/집계 UI | `frontend/src/components/` | `Dashboard.jsx`가 중심 |
| 데이터 소스 스위치 | `frontend/src/lib/` | PostgREST vs Supabase |
| 로컬 실행 토폴로지 | `docker-compose.yml` | collector health 이후 postgrest |

## CONVENTIONS

- 로컬 DB 모드에서는 frontend가 `/rest/v1`과 `/api/collector`를 dev proxy로 사용한다.
- frontend 읽기 경로는 `src/lib/database.js`를 통해 PostgREST/Supabase를 스위칭한다.
- collector는 `.env`와 환경변수로 동작하며, scheduler/job 설정도 `main.py`에서 관리한다.
- 스키마 변경은 fresh install용 `init-db/schema.sql`과 existing DB용 migration을 동시에 맞춘다.

## ANTI-PATTERNS

- dashboard 데이터 문제를 UI만 보고 판단하지 않는다. collector 로그와 `daily_stats` freshness를 함께 본다.
- schema widening 없이 overflow 문제를 비즈니스 로직 탓으로만 돌리지 않는다.
- PostgREST metadata refresh가 필요한 변경 후 restart를 빼먹지 않는다.

## SUB-DOCUMENTS

- `collector/AGENTS.md`
- `frontend/AGENTS.md`

## INCIDENT PLAYBOOK SUMMARY

- `daily_stats` 정체, `numeric field overflow`, 최신 model/key 누락이 보이면 collector logs → DB freshness → schema capacity → migration coverage 순으로 확인한다.
- 비용 컬럼은 `NUMERIC(20,6)`, 요청 카운터는 `BIGINT` 기준을 유지한다.
- backfill이 필요하면 당일 `first snapshot`과 `latest snapshot` delta를 기반으로 재구축한다.

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any shell command containing `curl` or `wget` will be intercepted and blocked by the context-mode plugin. Do NOT retry.
Instead use:
- `context-mode_ctx_fetch_and_index(url, source)` to fetch and index web pages
- `context-mode_ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any shell command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` will be intercepted and blocked. Do NOT retry with shell.
Instead use:
- `context-mode_ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### Direct web fetching — BLOCKED
Do NOT use any direct URL fetching tool. Use the sandbox equivalent.
Instead use:
- `context-mode_ctx_fetch_and_index(url, source)` then `context-mode_ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Shell (>20 lines output)
Shell is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `context-mode_ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `context-mode_ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### File reading (for analysis)
If you are reading a file to **edit** it → reading is correct (edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `context-mode_ctx_execute_file(path, language, code)` instead. Only your printed summary enters context.

### grep / search (large results)
Search results can flood context. Use `context-mode_ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `context-mode_ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `context-mode_ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `context-mode_ctx_execute(language, code)` | `context-mode_ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `context-mode_ctx_fetch_and_index(url, source)` then `context-mode_ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `context-mode_ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `upgrade` MCP tool, run the returned shell command, display as checklist |
