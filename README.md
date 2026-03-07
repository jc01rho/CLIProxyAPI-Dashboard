# CLIProxy Dashboard

Real-time dashboard for monitoring CLIProxy usage, token consumption, estimated cost, and credential health.

<p align="center">
  <img src="docs/assets/dashboard_preview.png" alt="CLIProxy Dashboard Preview" width="100%">
</p>

## What this project includes

- **Collector (Python/Flask)**: polls CLIProxy Management API, computes deltas/costs, writes to PostgreSQL
- **Frontend (React + Nginx)**: charts and analytics UI
- **PostgreSQL**: self-hosted DB initialized from `init-db/schema.sql`
- **PostgREST**: read-only API layer for frontend
- **Skill tracker plugin distribution** via marketplace + submodule (`plugin/claude-skills-tracker`)

## Architecture

```text
CLIProxy API → Collector (Python) → PostgreSQL
Browser → Nginx:8417
          ├── /rest/v1/*       → PostgREST:3000 → PostgreSQL (read)
          └── /api/collector/* → collector:5001 (write/trigger)
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
  secret: "your-management-secret-key"
```

Quick verification:

```bash
curl -H "Authorization: Bearer your-management-secret-key" \
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
DB_PASSWORD=your_secure_password_here
CLIPROXY_URL=http://host.docker.internal:8317
CLIPROXY_MANAGEMENT_KEY=your-management-secret-key

# Optional
COLLECTOR_INTERVAL_SECONDS=300
TIMEZONE_OFFSET_HOURS=7
```

### 5) Start services
```bash
docker compose up -d
```

Open dashboard at: **http://localhost:8417**

Expected startup order:
1. `postgres` healthy
2. `collector` healthy (DB init + migrations)
3. `postgrest` starts
4. `frontend` starts

> First data usually appears after the first collector interval.

---

## Verification

```bash
docker compose ps
docker compose logs -f collector
curl -X POST http://localhost:8417/api/collector/trigger
```

Success signals:
- collector logs periodic snapshot collection
- collector health endpoint responds
- manual trigger returns success

---

## Alternative: deploy from raw compose files only

If you don't want to clone the full repo:

```bash
mkdir cliproxy-dashboard && cd cliproxy-dashboard
curl -O https://raw.githubusercontent.com/leolionart/CLIProxyAPI-Dashboard/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/leolionart/CLIProxyAPI-Dashboard/main/.env.example
cp .env.example .env
# then edit .env and run:
docker compose up -d
```

---

## Skill Tracker Plugin Setup

Tracker plugin marketplace is now maintained in the dedicated tracker repository.

Inside Claude Code:

```claude
/plugin marketplace add leolionart/claude-skills-tracker
/plugin install cliproxy-skill-tracker
```

Optional endpoint override (if dashboard is not local):

```bash
export CLIPROXY_COLLECTOR_URL="https://your-domain/api/collector/skill-events"
```

**Dedupe note:** do not run both marketplace plugin hook and a manual `PostToolUse: Skill` hook at the same time.

---

## Common operations

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

---

## Development

### Frontend (hot reload)

```bash
docker compose up -d postgres postgrest
cd frontend
npm install
npm run dev
```

### Collector (local)

```bash
cd collector
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

---

## Troubleshooting

### Collector cannot reach CLIProxy

- Check `remote-management.allow-remote: true` in CLIProxy config
- Ensure `CLIPROXY_MANAGEMENT_KEY` matches CLIProxy `secret`
- Ensure `CLIPROXY_URL` is reachable from the collector container

### Dashboard has no data

- Wait until first collection interval
- Check collector logs: `docker compose logs -f collector`
- Trigger manually: `curl -X POST http://localhost:8417/api/collector/trigger`

### PostgREST errors about missing schema

- Confirm postgres is healthy before postgrest starts: `docker compose ps`
- If using an old pre-initialized volume, apply schema manually from `init-db/schema.sql`

---

## Key paths

- `collector/main.py` – collector + Flask endpoints
- `collector/db.py` – PostgreSQL client + migrations runner
- `collector/migrations/` – DB migrations (required for schema changes)
- `frontend/src/` – dashboard UI
- `.claude-plugin/marketplace.json` – plugin marketplace definition
- `plugin/claude-skills-tracker/` – tracker plugin submodule

---

## License

MIT — see [LICENSE](LICENSE).
