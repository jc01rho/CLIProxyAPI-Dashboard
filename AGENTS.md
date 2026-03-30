# AGENTS.md — Incident Playbook for Data Gaps / Overflow Cases

Tài liệu này dùng làm checklist chuẩn cho agent khi xử lý các sự cố dashboard thiếu dữ liệu dù DB vẫn có traffic.

## 0) Trigger conditions (khi nào phải chạy playbook này)

Chạy playbook nếu có ít nhất 1 dấu hiệu:
- UI thiếu model/key mới (vd: `gpt-5.3-codex`, key `claude`) dù hệ thống đang phát sinh usage.
- `daily_stats` đứng im hoặc tăng bất thường chậm.
- Collector log có lỗi ghi DB (`numeric field overflow`, `out of range`, `invalid input syntax`, v.v.).
- API `/rest/v1/daily_stats` trả dữ liệu cũ hơn snapshot mới nhất.

---

## 1) Triage nhanh (không sửa gì, chỉ xác nhận hiện trạng)

### 1.1 Service health
- `docker compose ps`
- Collector phải `healthy`, Postgres/PostgREST/frontend phải `Up`.

### 1.2 Collector logs (bắt buộc)
- `docker logs cliproxy-collector --tail=300`
- Check các chuỗi:
  - Có `Stored snapshot ...` đều đặn mỗi chu kỳ.
  - Không còn lỗi kiểu overflow/casting.
  - Có log migration mới được apply nếu vừa deploy (`Migration applied: ...`).

### 1.3 Data freshness (DB)
- So sánh snapshot mới nhất với `daily_stats` hôm nay:
  - `usage_snapshots` có bản ghi mới trong vòng 1 chu kỳ poll.
  - `daily_stats.stat_date=today` có `updated_at` mới.

---

## 2) Root cause matrix (phải check đủ, tránh bỏ sót)

### A. Schema capacity
- Cost columns có đủ lớn không?
  - `usage_snapshots.cumulative_cost_usd`
  - `model_usage.estimated_cost_usd`
  - `daily_stats.estimated_cost_usd`
- Counter columns có phải `BIGINT` không?
  - `usage_snapshots.total_requests/success_count/failure_count`
  - `model_usage.request_count`
  - `daily_stats.total_requests/success_count/failure_count`

### B. Migration coverage
- Đã cập nhật **cả hai** chưa?
  1. `init-db/schema.sql` (fresh install)
  2. `collector/migrations/*.sql` (existing DB)
- Collector startup có chạy `run_migrations()` và apply file mới không?

### C. Read path/UI path
- Frontend đọc từ `daily_stats` hay bảng khác?
- `daily_stats` có thể lệch dù `model_usage` đã mới.
- PostgREST có cần restart để refresh metadata sau schema change.

### D. Timezone/date boundary
- `TIMEZONE_OFFSET_HOURS` collector đúng với expectation chưa (mặc định `7`).
- Query “today” phải dùng cùng mốc timezone giữa DB check, collector, và UI.

---

## 3) Fix implementation checklist (khi sửa code/schema)

1. Mở rộng kiểu cost → `NUMERIC(20,6)`.
2. Nâng request counters → `BIGINT`.
3. Không đổi business logic trừ khi cần thiết; ưu tiên schema fix.
4. Migration chỉ widening type, không drop column/table.
5. Đặt tên migration tăng dần (`000N_...sql`).
6. Verify local diff chỉ chạm file cần thiết.

---

## 4) Production rollout checklist

1. Backup DB trước khi deploy (`pg_dump` hoặc snapshot volume).
2. Pull image mới.
3. Chạy `docker compose up -d` để khởi động theo dependency graph release-safe.
4. Xác nhận thứ tự boot kỳ vọng:
   - `postgres` healthy.
   - `collector` healthy (migrations đã apply xong).
   - `postgrest` chỉ start sau collector healthy.
   - `frontend` chỉ start sau postgrest start.
5. Theo dõi logs:
   - Collector có `Migration applied` hoặc migration skip hợp lệ.
   - Không còn lỗi overflow.
   - Không có lỗi PostgREST kiểu missing column/table ngay sau startup.
6. Chạy smoke API:
   - `GET /api/collector/health`
   - `GET /rest/v1/daily_stats?...limit=1`
   - `POST /api/collector/trigger` rồi verify lại read path.

---

## 5) Backfill checklist cho ngày hiện tại (khi daily_stats đã lệch)

### 5.1 Khi nào cần backfill
- `model_usage`/`usage_snapshots` có dữ liệu mới, nhưng `daily_stats` thấp rõ rệt/đứng im.

### 5.2 Nguyên tắc backfill
- Rebuild `daily_stats` cho `today` từ dữ liệu cumulative:
  - Dùng `first snapshot of day` và `latest snapshot of day`.
  - Delta = latest - first (restart-safe: nếu âm thì dùng latest).
- Rebuild `breakdown.models` và `breakdown.endpoints` từ `model_usage` tương ứng.
- Upsert đúng `stat_date=today`.

### 5.3 Sau backfill
- Restart `postgrest` + `frontend`.
- Verify API `/rest/v1/daily_stats?...stat_date=eq.today` trả số mới.
- Refresh UI Today để confirm.

---

## 6) Verification E2E (bắt buộc trước khi kết luận)

### 6.1 Logs
- Không còn lỗi overflow/cast trong collector logs 300 dòng gần nhất.
- Có ít nhất 2 chu kỳ `Stored snapshot ...` thành công sau deploy.

### 6.2 SQL checks
- `information_schema.columns` xác nhận đúng kiểu mới.
- `daily_stats(today)` cập nhật mới theo chu kỳ poll.
- `model_usage` snapshot mới nhất có model/endpoint kỳ vọng (vd `gpt-5.3-codex` + `claude`).
- `credential_daily_stats` có key kỳ vọng (`api_key_name='claude'`) và token tăng.

### 6.3 API/UI checks
- `GET /rest/v1/daily_stats?...` không còn đứng ở mốc cũ.
- UI Today khớp DB (requests/cost/model breakdown).

---

## 7) Rollback / mitigation

- Nếu migration lỗi do lock:
  1. Tạm dừng collector.
  2. Gỡ lock/đợi transaction.
  3. Chạy lại collector để migration apply.
- Nếu app lỗi sau deploy nhưng migration đã thành công:
  - Có thể rollback image collector/frontend (schema widening vẫn tương thích).
- Full DB restore chỉ dùng khi bất khả kháng.

---

## 8) Definition of Done (DoD)

Chỉ được đóng incident khi đủ tất cả:
- [ ] Collector logs sạch lỗi overflow tối thiểu 2 chu kỳ.
- [ ] `daily_stats(today)` cập nhật mới.
- [ ] API trả dữ liệu mới.
- [ ] UI phản ánh đúng model/key mới.
- [ ] Đã ghi nhận nguyên nhân gốc + migration đã merge/push.

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
