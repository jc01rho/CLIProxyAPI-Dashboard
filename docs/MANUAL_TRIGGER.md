# Manual Data Collection Trigger Guide

The Collector runs a lightweight Flask server alongside the scheduler so you can force an immediate sync without waiting for the next interval.

## 1) Operating Mechanism

- **Default port:** `5001` (configurable via `COLLECTOR_TRIGGER_PORT`).
- **Health probe:** `GET /api/collector/health` → returns `{status,timestamp}`.
- **Manual sync:** `POST /api/collector/trigger` → spawns a background thread that runs the full sync (fetch usage → compute costs → store snapshots/model_usage → update daily_stats breakdowns). Response is **202 Accepted** so the HTTP caller is not blocked.
- **Credential stats only:** `POST /api/collector/credential-stats/sync` triggers just the credential usage aggregator in its own thread.

## 2) How to trigger

Use any HTTP client (curl/Postman/etc.). Example:

```bash
curl -X POST http://localhost:5001/api/collector/trigger
```

Notes:
- Replace `localhost` with the collector host if you call remotely.
- If you changed `COLLECTOR_TRIGGER_PORT`, use that port.
- The management key is not required for the trigger endpoint; authentication is handled when the collector calls CLIProxy.

## 3) Responses

- **202 Accepted (happy path):**
  ```json
  {"message": "Full data collection process triggered."}
  ```
- **5xx:** Returned only if the collector cannot enqueue the job (e.g., database not initialized).

## 4) Practical use

- The dashboard “Refresh” button calls `POST /api/collector/trigger` so users can force a new snapshot.
- Automation/cron jobs can also hit the same endpoint after operational events (e.g., after rotating CLIProxy keys or restarting CLIProxy) to repopulate data immediately.
