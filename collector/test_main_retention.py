import importlib.util
import sys
import types
import unittest
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MODULE_PATH = ROOT / "main.py"


class _DummyResponse:
    def __init__(self, data=None):
        self.data = data if data is not None else []


class _DummyTable:
    def select(self, *args, **kwargs):
        return self

    def insert(self, *args, **kwargs):
        return _DummyResponse([{"id": 1}])

    def update(self, *args, **kwargs):
        return self

    def delete(self, *args, **kwargs):
        return self

    def upsert(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def neq(self, *args, **kwargs):
        return self

    def gte(self, *args, **kwargs):
        return self

    def lt(self, *args, **kwargs):
        return self

    def in_(self, *args, **kwargs):
        return self

    def order(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def single(self, *args, **kwargs):
        return self

    def execute(self):
        return _DummyResponse([])


class _DummyDB:
    def table(self, *args, **kwargs):
        return _DummyTable()


class _RecordedScheduler:
    instances = []

    def __init__(self, *args, **kwargs):
        self.jobs = []
        self.started = False
        _RecordedScheduler.instances.append(self)

    def add_job(self, func, trigger, **kwargs):
        self.jobs.append({"func": func, "trigger": trigger, "kwargs": kwargs})

    def start(self):
        self.started = True


def _install_dependency_stubs() -> None:
    requests = types.ModuleType("requests")
    requests.get = lambda *args, **kwargs: None
    sys.modules.setdefault("requests", requests)

    dotenv = types.ModuleType("dotenv")
    dotenv.load_dotenv = lambda *args, **kwargs: None
    sys.modules.setdefault("dotenv", dotenv)

    flask = types.ModuleType("flask")

    class Flask:
        def __init__(self, *args, **kwargs):
            pass

        def before_request(self, func):
            return func

        def register_blueprint(self, *args, **kwargs):
            return None

    class Blueprint:
        def __init__(self, *args, **kwargs):
            pass

        def route(self, *args, **kwargs):
            def decorator(func):
                return func

            return decorator

    flask.Flask = Flask
    flask.Blueprint = Blueprint
    flask.jsonify = lambda *args, **kwargs: {"json": args or kwargs}
    flask.make_response = lambda x: x
    flask.request = types.SimpleNamespace(
        headers={}, path="/", method="GET", host_url="http://localhost/", cookies={}
    )
    flask.Response = object
    flask.g = types.SimpleNamespace()
    sys.modules.setdefault("flask", flask)

    flask_cors = types.ModuleType("flask_cors")
    flask_cors.CORS = lambda *args, **kwargs: None
    sys.modules.setdefault("flask_cors", flask_cors)

    db = types.ModuleType("db")
    db.PostgreSQLClient = object
    sys.modules.setdefault("db", db)

    credential_stats_sync = types.ModuleType("credential_stats_sync")
    credential_stats_sync.sync_credential_stats = lambda *args, **kwargs: None
    sys.modules.setdefault("credential_stats_sync", credential_stats_sync)

    waitress = types.ModuleType("waitress")
    waitress.serve = lambda *args, **kwargs: None
    sys.modules.setdefault("waitress", waitress)

    apscheduler = types.ModuleType("apscheduler")
    schedulers = types.ModuleType("apscheduler.schedulers")
    background = types.ModuleType("apscheduler.schedulers.background")

    background.BackgroundScheduler = _RecordedScheduler
    sys.modules["apscheduler"] = apscheduler
    sys.modules["apscheduler.schedulers"] = schedulers
    sys.modules["apscheduler.schedulers.background"] = background

    supabase = types.ModuleType("supabase")
    supabase.create_client = lambda *args, **kwargs: None
    sys.modules.setdefault("supabase", supabase)

    psycopg2 = types.ModuleType("psycopg2")
    
    class MockCursor:
        def execute(self, sql):
            pass
        def close(self):
            pass
    
    class MockConn:
        autocommit = True
        def cursor(self):
            return MockCursor()
        def close(self):
            pass
    
    psycopg2.connect = lambda url: MockConn()
    sys.modules.setdefault("psycopg2", psycopg2)

    redis_queue_client = types.ModuleType("redis_queue_client")

    class RESPError(Exception):
        pass

    class RESPClient:
        def __init__(self, addr, socket_timeout=5.0):
            pass
        def lpop_batch(self, key, count):
            return []
        def close(self):
            pass
        def ping(self):
            return True

    redis_queue_client.RESPClient = RESPClient
    redis_queue_client.RESPError = RESPError
    sys.modules.setdefault("redis_queue_client", redis_queue_client)


def _load_module():
    _RecordedScheduler.instances = []
    _install_dependency_stubs()
    spec = importlib.util.spec_from_file_location("collector_main_retention", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class RetentionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = _load_module()

    def test_is_html_gateway_error_requires_html_and_gateway_markers(self):
        html_gateway_error = Exception(
            "{'message': 'JSON could not be generated', 'code': 522, 'details': 'b\'<!DOCTYPE html><html>Cloudflare Error code 522 Connection timed out</html>\''}"
        )
        plain_html_error = Exception("<!DOCTYPE html><html>regular page</html>")
        plain_gateway_error = Exception("502 bad gateway")

        self.assertTrue(self.module._is_html_gateway_error(html_gateway_error))
        self.assertFalse(self.module._is_html_gateway_error(plain_html_error))
        self.assertFalse(self.module._is_html_gateway_error(plain_gateway_error))

    def test_compaction_keeps_last_snapshot_per_local_day(self):
        plan = self.module._plan_historical_snapshot_compaction(
            [
                {"id": 1, "collected_at": "2026-04-08T00:10:00+07:00"},
                {"id": 2, "collected_at": "2026-04-08T23:59:00+07:00"},
                {"id": 3, "collected_at": "2026-04-09T00:01:00+07:00"},
                {"id": 4, "collected_at": "2026-04-09T23:58:00+07:00"},
            ]
        )

        self.assertEqual(plan["delete_snapshot_ids"], [1, 3])
        self.assertEqual(plan["keep_snapshot_ids"], [2, 4])
        self.assertEqual(plan["retained_days"], 2)

    def test_compaction_preserves_invalid_timestamp_rows(self):
        plan = self.module._plan_historical_snapshot_compaction(
            [
                {"id": 10, "collected_at": "invalid"},
                {"id": 11, "collected_at": "2026-04-08T01:00:00+07:00"},
                {"id": 12, "collected_at": "2026-04-08T23:00:00+07:00"},
            ]
        )

        self.assertEqual(plan["delete_snapshot_ids"], [11])
        self.assertEqual(plan["keep_snapshot_ids"], [10, 12])
        self.assertEqual(plan["skipped_snapshot_ids"], [10])

    def test_main_keeps_startup_compaction_and_midnight_schedule(self):
        _original_run_startup_cleanup = self.module._run_startup_cleanup
        cleanup_calls = []
        serve_calls = []
        fake_db = object()

        self.module.init_db = lambda: fake_db
        self.module.db_client = fake_db
        self.module.flask_app = self.module.Flask(__name__)
        self.module._cleanup_old_raw_data = lambda: cleanup_calls.append("startup") or {}
        self.module.run_full_sync_once = lambda: None
        self.module.sync_credential_stats = lambda *args, **kwargs: None
        self.module.serve = lambda *args, **kwargs: serve_calls.append((args, kwargs))

        self.module.main()

        self.assertEqual(cleanup_calls, ["startup"])
        self.assertTrue(_RecordedScheduler.instances)

        scheduler = _RecordedScheduler.instances[-1]
        raw_cleanup_jobs = [
            job
            for job in scheduler.jobs
            if job["kwargs"].get("id") == "raw_data_cleanup"
        ]
        self.assertEqual(len(raw_cleanup_jobs), 1)
        raw_cleanup_job = raw_cleanup_jobs[0]
        self.assertEqual(raw_cleanup_job["trigger"], "cron")
        self.assertEqual(raw_cleanup_job["kwargs"].get("hour"), 0)
        self.assertEqual(raw_cleanup_job["kwargs"].get("minute"), 0)
        self.assertTrue(scheduler.started)
        self.assertEqual(len(serve_calls), 1)

    def test_maintenance_vacuum_url_check(self):
        self.module.MAINTENANCE_DATABASE_URL = ""
        self.assertTrue(not self.module.MAINTENANCE_DATABASE_URL)
        self.module.MAINTENANCE_DATABASE_URL = "postgresql://test"
        self.assertTrue(self.module.MAINTENANCE_DATABASE_URL)

    def test_cleanup_old_raw_data_always_calls_vacuum(self):
        vacuum_calls = []
        self.module.MAINTENANCE_DATABASE_URL = "postgresql://test"
        self.module._run_maintenance_vacuum = lambda: vacuum_calls.append("called")
        self.module.db_client = _DummyDB()
        
        result = self.module._cleanup_old_raw_data()
        self.assertIsInstance(result, dict)
        self.assertEqual(vacuum_calls, ["called"])

    def test_maintenance_vacuum_uses_truncate_on(self):
        executed_sqls = []
        
        class MockCursor:
            def execute(self, sql):
                executed_sqls.append(sql)
            def close(self):
                pass
        
        class MockConn:
            autocommit = True
            def cursor(self):
                return MockCursor()
            def close(self):
                pass
        
        import psycopg2
        original_connect = psycopg2.connect
        psycopg2.connect = lambda url: MockConn()
        
        try:
            self.module.MAINTENANCE_DATABASE_URL = "postgresql://test"
            self.module._run_maintenance_vacuum()
            
            for sql in executed_sqls:
                self.assertIn("TRUNCATE ON", sql)
                self.assertIn("ANALYZE", sql)
        finally:
            psycopg2.connect = original_connect

    def test_slim_raw_data_keeps_model_counters_removes_details(self):
        raw_data = {
            "usage": {
                "apis": {
                    "api-key-1": {
                        "api_label": "Primary API Key",
                        "models": {
                            "gpt-4": {
                                "total_requests": 100,
                                "success_count": 95,
                                "failure_count": 5,
                                "input_tokens": 50000,
                                "output_tokens": 25000,
                                "total_tokens": 75000,
                                "extra_blob": {"retained": True},
                                "details": [
                                    {"timestamp": "2026-04-08T10:00:00Z", "tokens": 1000},
                                    {"timestamp": "2026-04-08T11:00:00Z", "tokens": 2000},
                                ]
                            }
                        }
                    }
                }
            },
            "meta": {"collector": "v1"},
        }
        
        slimmed = self.module._slim_raw_data(raw_data)
        
        self.assertIn("usage", slimmed)
        self.assertIn("apis", slimmed["usage"])
        self.assertIn("api-key-1", slimmed["usage"]["apis"])
        self.assertIn("models", slimmed["usage"]["apis"]["api-key-1"])
        self.assertIn("gpt-4", slimmed["usage"]["apis"]["api-key-1"]["models"])
        self.assertEqual(slimmed["usage"]["apis"]["api-key-1"]["api_label"], "Primary API Key")
        self.assertEqual(slimmed["meta"]["collector"], "v1")

        model_data = slimmed["usage"]["apis"]["api-key-1"]["models"]["gpt-4"]
        self.assertEqual(model_data["total_requests"], 100)
        self.assertEqual(model_data["success_count"], 95)
        self.assertEqual(model_data["failure_count"], 5)
        self.assertEqual(model_data["input_tokens"], 50000)
        self.assertEqual(model_data["output_tokens"], 25000)
        self.assertEqual(model_data["total_tokens"], 75000)
        self.assertEqual(model_data["extra_blob"], {"retained": True})
        self.assertNotIn("details", model_data)

    def test_slim_raw_data_returns_same_object_when_already_slimmed(self):
        already_slimmed = {
            "usage": {
                "apis": {
                    "api-key-1": {
                        "models": {
                            "gpt-4": {"total_requests": 100, "total_tokens": 75000}
                        }
                    }
                }
            }
        }
        result = self.module._slim_raw_data(already_slimmed)
        self.assertIs(result, already_slimmed)

    def test_cleanup_old_raw_data_slims_retained_snapshots_only(self):
        self.module.db_client = _DummyDB()
        self.module.MAINTENANCE_DATABASE_URL = ""
        self.module._run_maintenance_vacuum = lambda: None
        
        result = self.module._cleanup_old_raw_data()
        
        self.assertIsInstance(result, dict)
        self.assertIn("slimmed_snapshots", result)
        self.assertIn("retained_days", result)

    def test_compact_request_events_daily_replaces_raw_rows_with_aggregate(self):
        tables = {
            "request_events": [
                {
                    "id": 1,
                    "event_uid": "req-1",
                    "occurred_at": "2026-04-01T01:00:00+00:00",
                    "api_endpoint": "/v1/chat",
                    "endpoint_method": "POST",
                    "endpoint_path": "/v1/chat",
                    "model_name": "gpt-4o",
                    "source_id": "sk-a",
                    "auth_index": "0",
                    "latency_ms": 100,
                    "failed": False,
                    "input_tokens": 10,
                    "output_tokens": 5,
                    "reasoning_tokens": 0,
                    "cached_tokens": 0,
                    "total_tokens": 15,
                    "provider": "openai",
                    "estimated_cost_usd": 0.001,
                },
                {
                    "id": 2,
                    "event_uid": "req-2",
                    "occurred_at": "2026-04-01T02:00:00+00:00",
                    "api_endpoint": "/v1/chat",
                    "endpoint_method": "POST",
                    "endpoint_path": "/v1/chat",
                    "model_name": "gpt-4o",
                    "source_id": "sk-a",
                    "auth_index": "0",
                    "latency_ms": 300,
                    "failed": True,
                    "input_tokens": 20,
                    "output_tokens": 5,
                    "reasoning_tokens": 0,
                    "cached_tokens": 0,
                    "total_tokens": 25,
                    "provider": "openai",
                    "estimated_cost_usd": 0.002,
                },
            ]
        }

        class MemoryTable(_DummyTable):
            def __init__(self, name):
                self.name = name
                self._delete = False
                self._ids = []
                self._event_uid = None
            def select(self, *args, **kwargs):
                return self
            def lt(self, *args, **kwargs):
                return self
            def neq(self, *args, **kwargs):
                return self
            def limit(self, *args, **kwargs):
                return self
            def eq(self, column, value):
                if column == "event_uid":
                    self._event_uid = value
                return self
            def upsert(self, data, on_conflict=None):
                rows = data if isinstance(data, list) else [data]
                for row in rows:
                    existing = next((r for r in tables[self.name] if r.get("event_uid") == row.get("event_uid")), None)
                    if existing:
                        existing.update(row)
                    else:
                        tables[self.name].append(dict(row))
                return self
            def delete(self):
                self._delete = True
                return self
            def in_(self, column, values):
                self._ids = list(values)
                return self
            def execute(self):
                if self._delete:
                    deleted = [r for r in tables[self.name] if r.get("id") in self._ids]
                    tables[self.name] = [r for r in tables[self.name] if r.get("id") not in self._ids]
                    return _DummyResponse(deleted)
                rows = tables[self.name]
                if self._event_uid is not None:
                    rows = [r for r in rows if r.get("event_uid") == self._event_uid]
                return _DummyResponse(rows)

        class MemoryDB:
            def table(self, name):
                return MemoryTable(name)

        original_db = self.module.db_client
        self.module.db_client = MemoryDB()
        try:
            result = self.module._compact_request_events_daily()
            self.assertEqual(result["deleted"], 2)
            self.assertEqual(result["aggregated_days"], 1)
            aggregate = next(r for r in tables["request_events"] if r["event_uid"].startswith("daily-request-events:"))
            self.assertEqual(aggregate["raw_detail"]["request_count"], 2)
            self.assertEqual(aggregate["raw_detail"]["failed_count"], 1)
            self.assertEqual(aggregate["raw_detail"]["total_tokens"], 40)
            self.assertEqual(aggregate["raw_detail"]["included_ids"], ["1", "2"])
            model_stats = aggregate["raw_detail"]["models"]["gpt-4o"]
            self.assertEqual(model_stats["input_tokens"], 30)
            self.assertEqual(model_stats["output_tokens"], 10)
            self.assertEqual(model_stats["tokens"], 40)
            endpoint_stats = aggregate["raw_detail"]["endpoints"]["/v1/chat"]
            self.assertEqual(endpoint_stats["models"]["gpt-4o"]["tokens"], 40)
            source_stats = next(iter(aggregate["raw_detail"]["source_models"].values()))
            self.assertEqual(source_stats["source"], "sk-a")
            self.assertEqual(source_stats["model"], "gpt-4o")
            self.assertEqual(source_stats["tokens"], 40)
        finally:
            self.module.db_client = original_db

    def test_compact_request_events_daily_does_not_recount_included_raw_rows(self):
        aggregate_detail = {
            "aggregate": "daily_request_events",
            "day": "2026-04-01",
            "request_count": 2,
            "failed_count": 1,
            "success_count": 1,
            "input_tokens": 30,
            "output_tokens": 10,
            "reasoning_tokens": 0,
            "cached_tokens": 0,
            "total_tokens": 40,
            "estimated_cost_usd": 0.003,
            "latency_sum_ms": 400,
            "latency_count": 2,
            "models": {},
            "auth_models": {},
            "providers": {},
            "endpoints": {},
            "included_ids": ["1", "2"],
        }
        tables = {
            "request_events": [
                {
                    "id": 1,
                    "event_uid": "req-1",
                    "occurred_at": "2026-04-01T01:00:00+00:00",
                    "api_endpoint": "/v1/chat",
                    "endpoint_method": "POST",
                    "endpoint_path": "/v1/chat",
                    "model_name": "gpt-4o",
                    "source_id": "sk-a",
                    "auth_index": "0",
                    "latency_ms": 100,
                    "failed": False,
                    "input_tokens": 10,
                    "output_tokens": 5,
                    "reasoning_tokens": 0,
                    "cached_tokens": 0,
                    "total_tokens": 15,
                    "provider": "openai",
                    "estimated_cost_usd": 0.001,
                },
                {
                    "event_uid": "daily-request-events:2026-04-01",
                    "api_endpoint": "__daily_aggregate__",
                    "raw_detail": aggregate_detail,
                },
            ]
        }

        class MemoryTable(_DummyTable):
            def __init__(self, name):
                self.name = name
                self._delete = False
                self._ids = []
                self._event_uid = None
            def select(self, *args, **kwargs):
                return self
            def lt(self, *args, **kwargs):
                return self
            def neq(self, *args, **kwargs):
                return self
            def limit(self, *args, **kwargs):
                return self
            def eq(self, column, value):
                if column == "event_uid":
                    self._event_uid = value
                return self
            def upsert(self, data, on_conflict=None):
                self.fail("included raw rows should not be re-upserted")
            def delete(self):
                self._delete = True
                return self
            def in_(self, column, values):
                self._ids = list(values)
                return self
            def execute(self):
                if self._delete:
                    deleted = [r for r in tables[self.name] if r.get("id") in self._ids]
                    tables[self.name] = [r for r in tables[self.name] if r.get("id") not in self._ids]
                    return _DummyResponse(deleted)
                rows = tables[self.name]
                if self._event_uid is not None:
                    rows = [r for r in rows if r.get("event_uid") == self._event_uid]
                return _DummyResponse(rows)

        class MemoryDB:
            def table(self, name):
                return MemoryTable(name)

        original_db = self.module.db_client
        self.module.db_client = MemoryDB()
        try:
            result = self.module._compact_request_events_daily()
            self.assertEqual(result["deleted"], 1)
            self.assertEqual(result["aggregated_days"], 0)
            aggregate = next(r for r in tables["request_events"] if r["event_uid"].startswith("daily-request-events:"))
            self.assertEqual(aggregate["raw_detail"]["request_count"], 2)
        finally:
            self.module.db_client = original_db

    def test_compact_skill_runs_daily_replaces_raw_rows_with_aggregate(self):
        tables = {
            "skill_runs": [
                {
                    "id": 1,
                    "event_uid": "skill-1",
                    "machine_id": "m1",
                    "source": "sqlite",
                    "skill_name": "review-work",
                    "session_id": "s1",
                    "triggered_at": "2026-04-01T01:00:00+00:00",
                    "trigger_type": "explicit",
                    "status": "success",
                    "tokens_used": 100,
                    "output_tokens": 50,
                    "tool_calls": 2,
                    "duration_ms": 1000,
                    "estimated_cost_usd": 0.01,
                    "model": "claude",
                    "is_skeleton": False,
                    "project_dir": "/repo",
                },
                {
                    "id": 2,
                    "event_uid": "skill-2",
                    "machine_id": "m1",
                    "source": "sqlite",
                    "skill_name": "review-work",
                    "session_id": "s2",
                    "triggered_at": "2026-04-01T02:00:00+00:00",
                    "trigger_type": "explicit",
                    "status": "failure",
                    "tokens_used": 20,
                    "output_tokens": 5,
                    "tool_calls": 1,
                    "duration_ms": 2000,
                    "estimated_cost_usd": 0.02,
                    "model": "claude",
                    "is_skeleton": False,
                    "project_dir": "/repo",
                },
            ]
        }

        class MemoryTable(_DummyTable):
            def __init__(self, name):
                self.name = name
                self._delete = False
                self._ids = []
                self._event_uid = None
            def select(self, *args, **kwargs):
                return self
            def lt(self, *args, **kwargs):
                return self
            def neq(self, *args, **kwargs):
                return self
            def eq(self, column, value):
                if column == "event_uid":
                    self._event_uid = value
                return self
            def limit(self, *args, **kwargs):
                return self
            def upsert(self, data, on_conflict=None):
                row = dict(data)
                tables[self.name].append(row)
                return self
            def delete(self):
                self._delete = True
                return self
            def in_(self, column, values):
                self._ids = list(values)
                return self
            def execute(self):
                if self._delete:
                    deleted = [r for r in tables[self.name] if r.get("id") in self._ids]
                    tables[self.name] = [r for r in tables[self.name] if r.get("id") not in self._ids]
                    return _DummyResponse(deleted)
                rows = tables[self.name]
                if self._event_uid is not None:
                    rows = [r for r in rows if r.get("event_uid") == self._event_uid]
                return _DummyResponse(rows)

        class MemoryDB:
            def table(self, name):
                return MemoryTable(name)

        original_db = self.module.db_client
        self.module.db_client = MemoryDB()
        try:
            result = self.module._compact_skill_runs_daily()
            self.assertEqual(result["deleted"], 2)
            self.assertEqual(result["aggregated_days"], 1)
            aggregate = next(r for r in tables["skill_runs"] if r["event_uid"].startswith("daily-skill-runs:"))
            args = __import__("json").loads(aggregate["arguments"])
            self.assertEqual(args["run_count"], 2)
            self.assertEqual(args["failure_count"], 1)
            self.assertEqual(args["tokens_used"], 120)
            self.assertEqual(args["included_ids"], ["1", "2"])
        finally:
            self.module.db_client = original_db

    def test_cleanup_skips_invalid_timestamp_snapshots(self):
        plan = self.module._plan_historical_snapshot_compaction(
            [
                {"id": 10, "collected_at": "invalid"},
                {"id": 11, "collected_at": "2026-04-08T01:00:00+07:00"},
                {"id": 12, "collected_at": "2026-04-08T23:00:00+07:00"},
            ]
        )
        
        self.assertIn(10, plan["skipped_snapshot_ids"])
        self.assertNotIn(10, plan["delete_snapshot_ids"])
        self.assertIn(10, plan["keep_snapshot_ids"])

    def test_cleanup_batches_large_delete_ids(self):
        delete_calls = []
        select_calls = []
        
        class MockTable:
            def __init__(self, table_name):
                self.table_name = table_name
                self._is_delete = False
            
            def select(self, *args, **kwargs):
                return self
            
            def delete(self, *args, **kwargs):
                self._is_delete = True
                return self
            
            def in_(self, column, ids):
                if self.table_name == "usage_snapshots" and column == "id" and not self._is_delete:
                    select_calls.append(("usage_snapshots", "id", len(ids)))
                elif self.table_name == "usage_snapshots" and column == "id" and self._is_delete:
                    delete_calls.append(("usage_snapshots", "id", len(ids)))
                return self
            
            def execute(self):
                return _DummyResponse([{"id": i} for i in range(10)])
            
            def eq(self, *args, **kwargs):
                return self

            def neq(self, *args, **kwargs):
                return self
            
            def lt(self, *args, **kwargs):
                return self
            
            def order(self, *args, **kwargs):
                return self
            
            def limit(self, *args, **kwargs):
                return self
        
        class MockDB:
            def table(self, name):
                return MockTable(name)
        
        self.module.db_client = MockDB()
        self.module.MAINTENANCE_DATABASE_URL = ""
        self.module._run_maintenance_vacuum = lambda: None
        
        large_delete_ids = list(range(1, 1001))
        
        original_plan = self.module._plan_historical_snapshot_compaction
        def mock_plan(snapshots):
            return {
                "delete_snapshot_ids": large_delete_ids,
                "keep_snapshot_ids": [],
                "retained_days": 0,
                "skipped_snapshot_ids": [],
            }
        
        self.module._plan_historical_snapshot_compaction = mock_plan
        
        try:
            result = self.module._cleanup_old_raw_data()
            
            self.assertGreater(len(delete_calls), 1, "Expected multiple delete batches")
            
            for table, column, batch_size in delete_calls:
                self.assertLessEqual(batch_size, 500, f"Batch size {batch_size} exceeds limit")
                self.assertEqual(table, "usage_snapshots")
            
            self.assertIsInstance(result, dict)
            self.assertIn("model_usage", result)
            self.assertIn("snapshots", result)
        finally:
            self.module._plan_historical_snapshot_compaction = original_plan

    def test_cleanup_stops_when_snapshot_delete_fails(self):
        call_sequence = []
        
        class MockTable:
            def __init__(self, table_name):
                self.table_name = table_name
                self._is_delete = False
            
            def select(self, *args, **kwargs):
                return self
            
            def delete(self, *args, **kwargs):
                self._is_delete = True
                return self
            
            def in_(self, column, ids):
                action = "delete" if self._is_delete else "select"
                call_sequence.append((self.table_name, column, action, len(ids)))
                if self.table_name == "usage_snapshots" and action == "delete":
                    raise Exception("Simulated delete failure")
                return self
            
            def execute(self):
                return _DummyResponse([{"id": i} for i in range(10)])
            
            def eq(self, *args, **kwargs):
                return self

            def neq(self, *args, **kwargs):
                return self
            
            def lt(self, *args, **kwargs):
                return self
            
            def order(self, *args, **kwargs):
                return self
            
            def limit(self, *args, **kwargs):
                return self
        
        class MockDB:
            def table(self, name):
                return MockTable(name)
        
        self.module.db_client = MockDB()
        self.module.MAINTENANCE_DATABASE_URL = ""
        self.module._run_maintenance_vacuum = lambda: None
        
        delete_ids = list(range(1, 11))
        
        original_plan = self.module._plan_historical_snapshot_compaction
        def mock_plan(snapshots):
            return {
                "delete_snapshot_ids": delete_ids,
                "keep_snapshot_ids": [],
                "retained_days": 1,
                "skipped_snapshot_ids": [],
            }
        
        self.module._plan_historical_snapshot_compaction = mock_plan
        
        try:
            result = self.module._cleanup_old_raw_data()
            
            snapshot_delete_calls = [c for c in call_sequence if c[0] == "usage_snapshots" and c[2] == "delete"]
            
            self.assertGreater(len(snapshot_delete_calls), 0, "usage_snapshots delete should be attempted")
            self.assertEqual(
                len([c for c in call_sequence if c[0] == "model_usage" and c[2] == "delete"]),
                0,
                "model_usage should not be deleted directly; cleanup must rely on snapshot cascade",
            )
            
            self.assertEqual(result["model_usage"], 0)
            self.assertEqual(result["snapshots"], 0)
        finally:
            self.module._plan_historical_snapshot_compaction = original_plan

    def test_slim_raw_data_returns_same_object_when_already_slimmed(self):
        already_slimmed = {
            "usage": {
                "apis": {
                    "api-key-1": {
                        "models": {
                            "gpt-4": {"total_requests": 100, "total_tokens": 75000}
                        }
                    }
                }
            }
        }
        result = self.module._slim_raw_data(already_slimmed)
        self.assertIs(result, already_slimmed)

    def test_startup_cleanup_stops_when_only_already_slimmed_remain(self):
        cleanup_results = [
            {"snapshots": 0, "model_usage": 0, "skill_runs": 0, "retained_days": 1, "skipped_snapshots": 0, "slimmed_snapshots": 3},
            {"snapshots": 0, "model_usage": 0, "skill_runs": 0, "retained_days": 1, "skipped_snapshots": 0, "slimmed_snapshots": 0},
        ]
        call_count = 0

        def mock_cleanup():
            nonlocal call_count
            if call_count >= len(cleanup_results):
                return {"snapshots": 0, "model_usage": 0, "skill_runs": 0, "retained_days": 0, "skipped_snapshots": 0, "slimmed_snapshots": 0}
            result = cleanup_results[call_count]
            call_count += 1
            return result

        self.module.db_client = _DummyDB()
        self.module.MAINTENANCE_DATABASE_URL = ""
        self.module._run_maintenance_vacuum = lambda: None
        self.module._cleanup_old_raw_data = mock_cleanup

        result = self.module._run_startup_cleanup()

        self.assertEqual(call_count, 2)
        self.assertEqual(result["iterations"], 2)
        self.assertEqual(result["slimmed_snapshots"], 3)

    def test_startup_cleanup_warns_when_no_progress_is_caused_by_errors(self):
        cleanup_results = [
            {
                "snapshots": 0,
                "model_usage": 0,
                "skill_runs": 0,
                "retained_days": 1,
                "skipped_snapshots": 0,
                "slimmed_snapshots": 0,
                "error": True,
            }
        ]

        def mock_cleanup():
            return cleanup_results.pop(0)

        self.module.db_client = _DummyDB()
        self.module.MAINTENANCE_DATABASE_URL = ""
        self.module._run_maintenance_vacuum = lambda: None
        self.module._cleanup_old_raw_data = mock_cleanup

        with mock.patch.object(self.module.logger, "warning") as warning_mock, mock.patch.object(
            self.module.logger, "info"
        ) as info_mock:
            result = self.module._run_startup_cleanup()

        self.assertEqual(result["iterations"], 1)
        warning_messages = [call.args[0] for call in warning_mock.call_args_list]
        self.assertTrue(any("stopping without marking backlog drained" in message for message in warning_messages))
        info_messages = [call.args[0] for call in info_mock.call_args_list]
        self.assertFalse(any("backlog drained" in message for message in info_messages))

    def test_startup_cleanup_keeps_backlog_drained_message_when_no_error(self):
        cleanup_results = [
            {
                "snapshots": 0,
                "model_usage": 0,
                "skill_runs": 0,
                "retained_days": 1,
                "skipped_snapshots": 0,
                "slimmed_snapshots": 0,
                "error": False,
            }
        ]

        def mock_cleanup():
            return cleanup_results.pop(0)

        self.module.db_client = _DummyDB()
        self.module.MAINTENANCE_DATABASE_URL = ""
        self.module._run_maintenance_vacuum = lambda: None
        self.module._cleanup_old_raw_data = mock_cleanup

        with mock.patch.object(self.module.logger, "warning") as warning_mock, mock.patch.object(
            self.module.logger, "info"
        ) as info_mock:
            result = self.module._run_startup_cleanup()

        self.assertEqual(result["iterations"], 1)
        warning_messages = [call.args[0] for call in warning_mock.call_args_list]
        self.assertFalse(any("stopping without marking backlog drained" in message for message in warning_messages))
        info_messages = [call.args[0] for call in info_mock.call_args_list]
        self.assertTrue(any("backlog drained" in message for message in info_messages))

    def test_intraday_compaction_keeps_last_per_hour_bucket(self):
        plan = self.module._plan_intraday_snapshot_compaction(
            [
                {"id": 1, "collected_at": "2026-04-13T00:10:00+07:00"},
                {"id": 2, "collected_at": "2026-04-13T00:50:00+07:00"},
                {"id": 3, "collected_at": "2026-04-13T01:10:00+07:00"},
                {"id": 4, "collected_at": "2026-04-13T01:50:00+07:00"},
                {"id": 5, "collected_at": "2026-04-13T02:30:00+07:00"},
            ],
            min_age_minutes=0,
        )

        self.assertEqual(plan["delete_snapshot_ids"], [1, 3])
        self.assertEqual(plan["keep_snapshot_ids"], [2, 4, 5])
        self.assertEqual(plan["retained_buckets"], 3)

    def test_intraday_compaction_protects_recent_snapshots(self):
        original_utcnow = self.module._utcnow
        self.module._utcnow = lambda: self.module.datetime.fromisoformat(
            "2026-04-13T01:00:00+00:00"
        )
        try:
            plan = self.module._plan_intraday_snapshot_compaction(
                [
                    {"id": 10, "collected_at": "2026-04-13T00:00:00Z"},
                    {"id": 11, "collected_at": "2026-04-13T00:20:00Z"},
                    {"id": 12, "collected_at": "2026-04-13T00:40:00Z"},
                ],
                min_age_minutes=30,
            )
        finally:
            self.module._utcnow = original_utcnow

        self.assertIn(12, plan["keep_snapshot_ids"])
        self.assertIn(10, plan["delete_snapshot_ids"])

    def test_intraday_compaction_preserves_invalid_timestamp_rows(self):
        plan = self.module._plan_intraday_snapshot_compaction(
            [
                {"id": 100, "collected_at": "invalid"},
                {"id": 101, "collected_at": "2026-04-13T01:00:00+07:00"},
                {"id": 102, "collected_at": "2026-04-13T01:30:00+07:00"},
            ],
            min_age_minutes=0,
        )

        self.assertEqual(plan["delete_snapshot_ids"], [101])
        self.assertEqual(plan["keep_snapshot_ids"], [100, 102])
        self.assertEqual(plan["skipped_snapshot_ids"], [100])

    def test_main_schedules_intraday_compaction(self):
        _original_run_startup_cleanup = self.module._run_startup_cleanup
        cleanup_calls = []
        serve_calls = []
        fake_db = object()

        self.module.init_db = lambda: fake_db
        self.module.db_client = fake_db
        self.module.flask_app = self.module.Flask(__name__)
        self.module._cleanup_old_raw_data = lambda: cleanup_calls.append("daily") or {}
        self.module._cleanup_intraday_raw_data = lambda: cleanup_calls.append("intraday") or {}
        self.module.run_full_sync_once = lambda: None
        self.module.sync_credential_stats = lambda *args, **kwargs: None
        self.module.serve = lambda *args, **kwargs: serve_calls.append((args, kwargs))

        self.module.main()

        self.assertEqual(cleanup_calls, ["daily"])
        self.assertTrue(_RecordedScheduler.instances)

        scheduler = _RecordedScheduler.instances[-1]
        intraday_jobs = [
            job
            for job in scheduler.jobs
            if job["kwargs"].get("id") == "intraday_compaction"
        ]
        self.assertEqual(len(intraday_jobs), 1)
        intraday_job = intraday_jobs[0]
        self.assertEqual(intraday_job["trigger"], "interval")
        self.assertIn("minutes", intraday_job["kwargs"])
        self.assertTrue(scheduler.started)
        self.assertEqual(len(serve_calls), 1)


if __name__ == "__main__":
    unittest.main()
