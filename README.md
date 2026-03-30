# CLIProxy Dashboard

Real-time dashboard for monitoring CLIProxy usage, token consumption, estimated cost, and credential health.

<p align="center">
  <img src="docs/assets/dashboard_preview.png" alt="CLIProxy Dashboard Preview" width="100%">
</p>

## What this project includes

- **Collector (Python/Flask)**: polls CLIProxy Management API, computes deltas/costs, writes to local PostgreSQL or Supabase
- **Frontend (React + Nginx)**: charts and analytics UI
- **PostgreSQL**: self-hosted DB initialized from `init-db/schema.sql` when using local mode
- **PostgREST**: read-only API layer for frontend in local mode
- **Skill tracker plugin distribution** via marketplace + submodule (`plugin/claude-skills-tracker`)

## Architecture

```text
CLIProxy API → Collector (Python) → local PostgreSQL or Supabase
Browser → Nginx:8417
          ├── local mode: /rest/v1/*       → PostgREST:3000 → PostgreSQL (read)
          ├── supabase mode: frontend      → Supabase REST (read)
          └── /api/collector/*             → collector:5001 (write/trigger)
```

---

## Quick Start (run from this repository)

### 1) Prerequisites

- Docker + Docker Compose v2
- CLIProxy with remote management enabled

### 2) Configure CLIProxy Management API

Ensure your CLIProxy config includes:

```yaml
remote-management:
  allow-remote: true
  secret: "<your-management-secret>"
```

Quick verification:

```bash
curl -H "Authorization: Bearer <your-management-secret>" \
  http://localhost:8317/v0/management/usage
```

You should receive a JSON usage response.

### 3) Clone and initialize submodule

```bash
git clone https://github.com/leolionart/CLIProxyAPI-Dashboard.git
cd CLIProxyAPI-Dashboard
git submodule update --init --recursive
```

### 4) Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_PROVIDER=local
VITE_DATABASE_PROVIDER=local
DB_PASSWORD=your_secure_password_here
CLIPROXY_URL=http://host.docker.internal:8317
CLIPROXY_MANAGEMENT_KEY=<your-management-secret>
ADMIN_PASSWORD=change-me

# Optional
COLLECTOR_INTERVAL_SECONDS=300
TIMEZONE_OFFSET_HOURS=7
ADMIN_SESSION_TTL_DAYS=30
ADMIN_SESSION_SECURE_COOKIE=false
ADMIN_SESSION_SAMESITE=Lax
```

Notes:
- Dashboard now requires admin login before loading UI or `/rest/v1/*` data.
- The browser stores only an `HttpOnly` session cookie; the password is never stored in browser storage.
- If you deploy behind HTTPS, set `ADMIN_SESSION_SECURE_COOKIE=true`.
- Default host port for PostgREST is now `8418` to avoid common conflicts on `3000`. Override with `POSTGREST_HOST_PORT` if needed.
- `ADMIN_ALLOWED_ORIGINS` is optional. Leave it empty for the default same-compose setup; set it only if you want stricter Origin/Referer enforcement.
- For local mode, services `postgres` and `postgrest` run under the `localdb` compose profile.
- To use Supabase mode, set `DATABASE_PROVIDER=supabase` and provide `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`.

### 5) Start services
```bash
COMPOSE_PROFILES=localdb docker compose up -d
```

Open dashboard at: **http://localhost:8417**

Expected startup order in local mode:
1. `postgres` healthy
2. `collector` healthy (DB init + migrations)
3. `postgrest` starts
4. `frontend` starts

> First data usually appears after the first collector interval.

### Optional: run with Supabase as database

If you want both collector and dashboard reads to use Supabase again:

```env
DATABASE_PROVIDER=supabase
VITE_DATABASE_PROVIDER=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=<your-service-role-key>
SUPABASE_PUBLISHABLE_KEY=<your-publishable-key>
```

Notes:
- The dashboard still uses `/api/collector/*` for admin login, health checks, trigger, and logs.
- Supabase mode bypasses local `/rest/v1` reads and uses `@supabase/supabase-js` in the browser.
- Collector uses the Python Supabase client with `SUPABASE_SECRET_KEY` in this mode.
- Your Supabase project must expose the same tables/views used by the dashboard and allow the publishable key to read them through RLS/policies as needed.
- In Supabase mode you do not need the `localdb` compose profile.

Start Supabase mode with:

```bash
docker compose up -d collector frontend
```

---

<details>
<summary><h2>Verification</h2></summary>

```bash
docker compose ps
docker compose logs -f collector
curl -X POST http://localhost:8417/api/collector/trigger
```

Success signals:
- collector logs periodic snapshot collection
- collector health endpoint responds
- manual trigger returns success

</details>

---

<details>
<summary><h2>Alternative: deploy from raw compose files only</h2></summary>

If you don't want to clone the full repo:

```bash
mkdir cliproxy-dashboard && cd cliproxy-dashboard
curl -O https://raw.githubusercontent.com/leolionart/CLIProxyAPI-Dashboard/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/leolionart/CLIProxyAPI-Dashboard/main/.env.example
cp .env.example .env
# then edit .env and run:
docker compose up -d
```

</details>

---

<details>
<summary><h2>Skill Tracker Plugin Setup</h2></summary>

Tracker plugin is now distributed from the shared Claude skills marketplace.

- **Marketplace repo:** `leolionart/claude-skills`
- **Plugin install ID:** `claude-skill-tracker`

Inside Claude Code:

```claude
/plugin marketplace add leolionart/claude-skills
/plugin install claude-skill-tracker
/reload-plugins
```

Optional endpoint override (if dashboard is not local):

```bash
export CLIPROXY_COLLECTOR_URL="https://your-domain/api/collector/skill-events"
```

**Dedupe note:** do not run both marketplace plugin hook and a manual `PostToolUse: Skill` hook at the same time.

</details>

---

<details>
<summary><h2>Optional: Lark Suite MCP + local skill</h2></summary>

This repo now includes templates to enable Lark task data access from Claude Code.

### 1) Prepare local MCP config (do not commit secrets)

```bash
cp .mcp.json.example .mcp.json
```

`.mcp.json` is ignored by git in this repo, so keep real credentials there.

### 2) Set local environment variables

Use your shell profile (or export in current terminal):

```bash
export LARK_APP_ID="cli_xxx"
export LARK_APP_SECRET="your-lark-app-secret"
export LARK_DOMAIN="https://open.larksuite.com"
export LARK_TOOLSETS="preset.base,preset.task,task.v2.task.get,task.v2.task.list,task.v2.tasklist.list,task.v2.tasklist.tasks"
```

### 3) Reload Claude Code session

After saving `.mcp.json` and env vars, restart Claude Code (or reload) so `lark-mcp` can start.

### 4) Use repo-local skill

Skill file: `.claude/skills/lark-suite/SKILL.md`

Ask naturally, for example:
- "Lấy danh sách task đang open trong Lark"
- "Lấy chi tiết task theo ID ..."
- "Tóm tắt task theo trạng thái"

</details>

---

<details>
<summary><h2>Common operations</h2></summary>

### Update services

```bash
docker compose pull
docker compose up -d
```

### Health and smoke checks

```bash
docker compose ps
docker compose logs --tail=200 collector postgrest frontend
curl http://localhost:8417/api/collector/health
curl "http://localhost:8417/rest/v1/daily_stats?select=date,total_requests&order=date.desc&limit=1"
curl -X POST http://localhost:8417/api/collector/trigger
```

</details>

---

<details>
<summary><h2>Development</h2></summary>

### Frontend (hot reload)

`docker-compose.override.yml` is the local dev override and is loaded automatically by `docker compose`.
For source-only changes, prefer bind mounts + service restart. Rebuild images only when Dockerfile or dependencies changed.

```bash
docker compose up -d postgres postgrest
cd frontend
npm install
DATABASE_PROVIDER=local VITE_DATABASE_PROVIDER=local POSTGREST_HOST_PORT=8418 npm run dev
```

Open Vite dev UI at `http://localhost:5173`.

> Keep the local collector running too. Vite dev proxy now checks the same auth session flow as production, so `/rest/v1/*` stays locked until you log in.

For Supabase dev mode:

```bash
VITE_DATABASE_PROVIDER=supabase \
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_PUBLISHABLE_KEY=<your-publishable-key> \
npm run dev
```

Collector with Supabase in local development:

```bash
cd collector
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SECRET_KEY=<your-service-role-key> \
DATABASE_PROVIDER=supabase \
python main.py
```

If you run the collector outside Docker, install Python dependencies first and then run it, for example:

```bash
cd collector
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
DATABASE_PROVIDER=supabase \
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SECRET_KEY=<your-service-role-key> \
python main.py
```

### Collector (local)

```bash
cd collector
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

</details>

---

<details>
<summary><h2>Troubleshooting</h2></summary>

### Collector cannot reach CLIProxy

- Check `remote-management.allow-remote: true` in CLIProxy config
- Ensure `CLIPROXY_MANAGEMENT_KEY` matches CLIProxy `secret`
- Ensure `CLIPROXY_URL` is reachable from the collector container

### Dashboard has no data

- Wait until first collection interval
- Check collector logs: `docker compose logs -f collector`
- Trigger manually after logging in: `curl -X POST http://localhost:8417/api/collector/trigger`

### Login does not work

- Ensure `.env` contains `ADMIN_PASSWORD` and that it matches what you enter on the login screen
- For HTTPS deployments, set `ADMIN_SESSION_SECURE_COOKIE=true`; for local HTTP keep it `false`
- If you use a custom origin or reverse proxy, set `ADMIN_ALLOWED_ORIGINS` to the public dashboard origin

### PostgREST errors about missing schema

- Confirm postgres is healthy before postgrest starts: `docker compose ps`
- If using an old pre-initialized volume, apply schema manually from `init-db/schema.sql`

### Port 3000 already allocated

- PostgREST now defaults to host port `8418` instead of `3000`
- If you want a different host port, set `POSTGREST_HOST_PORT` in `.env`
- If Vite dev is already running, restart it after changing `POSTGREST_HOST_PORT`

</details>

---

<details>
<summary><h2>Key paths</h2></summary>

- `collector/main.py` – collector + Flask endpoints
- `collector/db.py` – PostgreSQL client + migrations runner
- `collector/migrations/` – DB migrations (required for schema changes)
- `frontend/src/` – dashboard UI
- `plugin/claude-skills-tracker/` – tracker plugin submodule (source mirror for dashboard development)
- Tracker marketplace source of truth: `leolionart/claude-skills`

</details>

---

## License

MIT — see [LICENSE](LICENSE).
