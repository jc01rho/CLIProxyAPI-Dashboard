# CLIProxy Dashboard

Real-time monitoring dashboard for CLIProxy API usage — track requests, tokens, costs, and OAuth credentials across all your AI models.

![Dashboard Preview](https://img.shields.io/badge/status-active-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Docker](https://img.shields.io/badge/docker-ready-blue)

<p align="center">
  <img src="docs/assets/dashboard_preview.png" alt="CLIProxy Dashboard Preview" width="100%">
</p>

## Features

- **Usage Analytics** — Track requests, tokens, success rates over time
- **Cost Estimation** — Calculate estimated API costs per model
- **Date Range Filters** — View Today, Yesterday, 7 Days, 30 Days, or All Time
- **Hourly Breakdown** — See usage patterns throughout the day
- **Model Breakdown** — Usage and cost per AI model
- **OAuth Credentials** — Monitor Antigravity, Codex, and Gemini CLI credentials with subscription status

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- CLIProxy running with Management API enabled

> No external database account needed — PostgreSQL runs inside Docker automatically.

### 1. Download Configuration

```bash
mkdir cliproxy-dashboard && cd cliproxy-dashboard

curl -O https://raw.githubusercontent.com/leolionart/CLIProxyAPI-Dashboard/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/leolionart/CLIProxyAPI-Dashboard/main/.env.example
cp .env.example .env
```

### 2. Configure Environment

Edit `.env`:

```env
# PostgreSQL password (choose any secure password)
DB_PASSWORD=your_secure_password_here

# CLIProxy Connection
CLIPROXY_URL=http://host.docker.internal:8317
CLIPROXY_MANAGEMENT_KEY=your-management-secret-key

# Optional
COLLECTOR_INTERVAL_SECONDS=300
TIMEZONE_OFFSET_HOURS=7
```

### 3. Start Dashboard

```bash
docker compose up -d
```

Docker will automatically:
- Start a PostgreSQL database and create all tables on first boot
- Start PostgREST as the API layer
- Start the collector (polls CLIProxy every 5 minutes)
- Start the frontend dashboard

### 4. Access Dashboard

Open your browser: **http://localhost:8417**

> First data appears after ~5 minutes (first collection cycle).

---

## Updating

```bash
docker compose pull
docker compose up -d
```

### Release Boot Order (expected)

After `docker compose up -d`, startup is constrained in this order:
1. `postgres` becomes `healthy`
2. `collector` starts and becomes `healthy` (DB init + migrations done)
3. `postgrest` starts (after `collector` healthy)
4. `frontend` starts (after `collector` healthy + `postgrest` started)

### Release Smoke Checklist

```bash
docker compose ps
docker compose logs --tail=200 collector postgrest frontend
curl http://localhost:8417/api/collector/health
curl "http://localhost:8417/rest/v1/daily_stats?select=date,total_requests&order=date.desc&limit=1"
curl -X POST http://localhost:8417/api/collector/trigger
```

Success signals:
- Collector logs show migrations applied/skipped without errors
- No PostgREST runtime errors about missing column/table
- `/api/collector/health` returns healthy response
- `/rest/v1/daily_stats` returns data after startup and after trigger

---

## Configuration Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_PASSWORD` | PostgreSQL password | Required |
| `CLIPROXY_URL` | CLIProxy Management API URL | `http://host.docker.internal:8317` |
| `CLIPROXY_MANAGEMENT_KEY` | CLIProxy management secret | Required |
| `COLLECTOR_INTERVAL_SECONDS` | Polling interval (seconds) | `300` |
| `TIMEZONE_OFFSET_HOURS` | Timezone offset from UTC | `7` |

---

## Troubleshooting

### Check Logs

```bash
docker compose logs -f             # All services
docker compose logs -f collector   # Collector only
docker compose logs -f frontend    # Frontend only
```

### Check Service Status

```bash
docker compose ps
```

All services should show `healthy` or `running`.

### Common Issues

**Dashboard shows no data:**
- Wait 5 minutes for first data collection
- Check collector logs for connection errors to CLIProxy

**Collector can't connect to CLIProxy:**
- Ensure CLIProxy has `remote-management.allow-remote: true`
- Verify `CLIPROXY_MANAGEMENT_KEY` matches CLIProxy's secret
- On Linux, confirm `extra_hosts: host.docker.internal:host-gateway` resolves correctly

**PostgREST/database errors:**
- Run `docker compose ps` — postgres must be `healthy` before postgrest starts
- Check postgres logs: `docker compose logs postgres`

---

<details>
<summary><h2>Configure CLIProxy</h2></summary>

Ensure your CLIProxy config has Management API enabled:

```yaml
remote-management:
  allow-remote: true
  secret: "your-management-secret-key"
```

Use the same `secret` value as `CLIPROXY_MANAGEMENT_KEY` in your `.env`.

</details>

---

<details>
<summary><h2>Developer Guide</h2></summary>

### Local Frontend Development

```bash
# Start postgres + postgrest in Docker first
docker compose up -d postgres postgrest

# Then run Vite dev server
cd frontend
npm install
npm run dev
```

Access at `http://localhost:5173` with hot reload.

### Local Collector Development

```bash
cd collector
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Requires `.env` with `DATABASE_URL` (or set env vars manually).

### Project Structure

```
cliproxy-dashboard/
├── collector/              # Python data collector
│   ├── main.py             # Collector logic + Flask API
│   ├── db.py               # PostgreSQL client (psycopg2)
│   ├── credential_stats_sync.py
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/               # React dashboard
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   └── lib/supabase.js # PostgREST client via supabase-js
│   ├── nginx.conf          # Nginx with PostgREST proxy
│   ├── Dockerfile
│   └── package.json
├── init-db/
│   └── schema.sql          # Auto-applied on first postgres boot
├── docker-compose.yml
├── .env.example
└── README.md
```

### Architecture

```
Browser → Nginx (port 8417)
           ├── /rest/v1/*       → PostgREST:3000 (reads, anonymous)
           └── /api/collector/* → collector:5001 (writes + triggers)

Collector Flask → PostgreSQL:5432 (psycopg2, writes)
PostgREST       → PostgreSQL:5432 (reads)
```

</details>

---

<details>
<summary><h2>Dashboard Usage Guide</h2></summary>

### Date Range Tabs

| Tab | Description |
|-----|-------------|
| **Today** | Usage delta for current day only |
| **Yesterday** | Usage delta for previous day |
| **7 Days** | Total usage over past week |
| **30 Days** | Total usage over past month |
| **This Year** | Total usage for current year |

### Dashboard Sections

1. **Stats Cards** — Total requests, tokens, success rate
2. **Request Trends** — Line chart of requests over time
3. **Token Usage Trends** — Line chart of token consumption
4. **Cost Breakdown** — Pie chart of costs by model
5. **Model Usage** — Bar chart of requests per model
6. **OAuth Credentials** — Status and quota per credential
7. **Cost Details** — Detailed cost table by model

### Default Model Pricing (USD per 1M tokens)

| Model | Input | Output |
|-------|-------|--------|
| GPT-4o | $2.50 | $10.00 |
| GPT-4o-mini | $0.15 | $0.60 |
| Claude 3.5 Sonnet | $3.00 | $15.00 |
| Claude 4 Sonnet | $3.00 | $15.00 |
| Gemini 2.5 Flash | $0.15 | $0.60 |
| Gemini 2.5 Pro | $1.25 | $10.00 |

To update pricing, edit the `model_pricing` table directly:

```bash
docker compose exec postgres psql -U cliproxy -d cliproxy
# UPDATE model_pricing SET input_price_per_million = 2.50 WHERE model_pattern = 'gpt-4o';
```

</details>

---

## License

MIT License — see [LICENSE](LICENSE) file for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Support

If you find this project helpful, please give it a star!
