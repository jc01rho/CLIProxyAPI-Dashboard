# DASHBOARD FRONTEND

> Parent: [../AGENTS.md](../AGENTS.md)

## OVERVIEW

`frontend/` is the React 18 + Vite dashboard UI served by nginx. It reads PostgREST or Supabase through a small data layer and renders usage, cost, credential, request event, log, and skill panels.

## STRUCTURE

```text
frontend/
├── src/main.jsx
├── src/App.jsx
├── src/components/
│   ├── Dashboard.jsx
│   ├── CredentialStatsCard.jsx
│   ├── RequestEventsPanel.jsx
│   ├── LogViewerPanel.jsx
│   └── SkillsPanel.jsx
├── src/lib/
│   ├── database.js / postgrest.js / supabase.js
│   ├── runtimeConfig.js
│   └── brandColors.js
├── src/workers/credentialAggregation.worker.js
├── nginx.conf
└── docker-entrypoint.sh
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Top-level state | `src/App.jsx` | Session timeout fallback and data loading. |
| Main charts | `src/components/Dashboard.jsx` | Recharts + date filters. |
| Request events | `src/components/RequestEventsPanel.jsx` | Provider/cost filters and CSV. |
| Credential stats | `src/components/CredentialStatsCard.jsx` | API key × model failure-rate rows. |
| Data source switch | `src/lib/database.js`, `runtimeConfig.js` | PostgREST vs Supabase. |
| Production proxy | `nginx.conf`, `docker-entrypoint.sh` | auth_request + runtime app-config.js. |

## CONVENTIONS

- Use `selectRows`/`selectSingle` from `src/lib/database.js`; do not import PostgREST/Supabase clients directly in panels.
- Runtime env priority is `window.__APP_CONFIG__` → `import.meta.env` → fallback.
- Large credential aggregations belong in `src/workers/credentialAggregation.worker.js` or memoized helpers, not render loops.
- Keep provider/cost CSV fields aligned with collector `request_events` schema.

## COMMANDS

```bash
npm run build
npm run dev
npm run preview
```

## ANTI-PATTERNS

- Do not rely on `VITE_DEV_BYPASS_AUTH` behavior in production code.
- Do not hardwire Supabase-only assumptions into UI panels.
- Do not add long-running aggregation directly inside React render paths.
- Do not ignore collector auth/session timeout; app must fall back to login on stalled requests.
