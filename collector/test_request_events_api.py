import importlib.util
import json
import sys
import tempfile
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent
MODULE_PATH = ROOT / "main.py"


def _install_dependency_stubs():
    requests = types.ModuleType("requests")
    requests.get = lambda *a, **kw: None
    sys.modules.setdefault("requests", requests)

    dotenv = types.ModuleType("dotenv")
    dotenv.load_dotenv = lambda *a, **kw: None
    sys.modules.setdefault("dotenv", dotenv)

    flask = types.ModuleType("flask")

    class Flask:
        def __init__(self, *a, **kw):
            pass
        def before_request(self, func):
            return func
        def register_blueprint(self, *a, **kw):
            pass

    class Blueprint:
        def __init__(self, *a, **kw):
            pass
        def route(self, *a, **kw):
            def decorator(func):
                return func
            return decorator

    flask.Flask = Flask
    flask.Blueprint = Blueprint
    flask.jsonify = lambda x: x
    flask.make_response = lambda x: x
    flask.request = types.SimpleNamespace(
        headers={}, path="/", method="GET", host_url="http://localhost/",
        cookies={}, args={},
    )
    flask.Response = object
    flask.g = types.SimpleNamespace()
    sys.modules.setdefault("flask", flask)

    flask_cors = types.ModuleType("flask_cors")
    flask_cors.CORS = lambda *a, **kw: None
    sys.modules.setdefault("flask_cors", flask_cors)

    db = types.ModuleType("db")
    db.PostgreSQLClient = object
    sys.modules.setdefault("db", db)

    credential_stats_sync = types.ModuleType("credential_stats_sync")
    credential_stats_sync.sync_credential_stats = lambda *a, **kw: None
    sys.modules.setdefault("credential_stats_sync", credential_stats_sync)

    waitress = types.ModuleType("waitress")
    waitress.serve = lambda *a, **kw: None
    sys.modules.setdefault("waitress", waitress)

    apscheduler = types.ModuleType("apscheduler")
    schedulers = types.ModuleType("apscheduler.schedulers")
    background = types.ModuleType("apscheduler.schedulers.background")

    class _FakeScheduler:
        def add_job(self, *a, **kw):
            pass
        def start(self):
            pass

    background.BackgroundScheduler = _FakeScheduler
    sys.modules["apscheduler"] = apscheduler
    sys.modules["apscheduler.schedulers"] = schedulers
    sys.modules["apscheduler.schedulers.background"] = background

    supabase = types.ModuleType("supabase")
    supabase.create_client = lambda *a, **kw: None
    sys.modules.setdefault("supabase", supabase)

    psycopg2 = types.ModuleType("psycopg2")

    class MockCursor:
        def execute(self, sql, params=None):
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

    redis_queue_client.RESPClient = RESPClient
    redis_queue_client.RESPError = RESPError
    sys.modules.setdefault("redis_queue_client", redis_queue_client)


def _load_module():
    _install_dependency_stubs()
    spec = importlib.util.spec_from_file_location("collector_main_re_api_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    module.jsonify = lambda x=None, *args, **kwargs: x if x is not None else kwargs
    return module


class _DummyTable:
    def __init__(self):
        self._data = []
    def upsert(self, *a, **kw):
        return self
    def insert(self, *a, **kw):
        return self
    def select(self, *a, **kw):
        return self
    def eq(self, *a, **kw):
        return self
    def neq(self, *a, **kw):
        return self
    def gte(self, *a, **kw):
        return self
    def lt(self, *a, **kw):
        return self
    def order(self, *a, **kw):
        return self
    def limit(self, *a, **kw):
        return self
    def execute(self):
        return types.SimpleNamespace(data=self._data)


class _DummyDB:
    def __init__(self, table_data=None):
        self._table_data = table_data or {}
    def table(self, name):
        t = _DummyTable()
        t._data = self._table_data.get(name, [])
        return t


class TransformQueueEventCostProviderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = _load_module()

    def test_provider_extracted_from_payload(self):
        payload = {
            "timestamp": "2026-04-15T10:00:00Z",
            "model": "gpt-4o",
            "provider": "openai",
            "tokens": {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150},
        }
        row = self.module._transform_queue_event(payload)
        self.assertIsNotNone(row)
        self.assertEqual(row["provider"], "openai")

    def test_admin_session_pgrst116_returns_none_without_error_log(self):
        class _PgrstNoRowsError(Exception):
            def __init__(self):
                super().__init__({
                    "message": "Cannot coerce the result to a single JSON object",
                    "code": "PGRST116",
                    "details": "The result contains 0 rows",
                })

        class _NoRowsTable(_DummyTable):
            def single(self):
                return self
            def execute(self):
                raise _PgrstNoRowsError()

        class _NoRowsDB:
            def table(self, name):
                self.name = name
                return _NoRowsTable()

        original_db = self.module.db_client
        self.module.db_client = _NoRowsDB()
        try:
            with mock.patch.object(self.module.logger, "error") as error_mock:
                self.assertIsNone(self.module._get_session_row("missing-session-token"))
            error_mock.assert_not_called()
        finally:
            self.module.db_client = original_db

    def test_admin_session_row_is_cached_for_ttl(self):
        calls = []
        row = {
            "id": 7,
            "token_hash": self.module._hash_session_token("session-token"),
            "expires_at": "2026-05-01T01:00:00+00:00",
            "revoked_at": None,
            "remember_me": False,
        }

        class _SessionTable(_DummyTable):
            def single(self):
                return self
            def execute(self):
                calls.append("select")
                return types.SimpleNamespace(data=row)

        class _DB:
            def table(self, name):
                return _SessionTable()

        original_db = self.module.db_client
        original_ttl = self.module.ADMIN_SESSION_CACHE_TTL_SECONDS
        self.module.db_client = _DB()
        self.module.ADMIN_SESSION_CACHE_TTL_SECONDS = 300
        self.module._admin_session_cache.clear()
        try:
            with mock.patch.object(self.module, "_utcnow", return_value=datetime(2026, 5, 1, tzinfo=timezone.utc)):
                self.assertEqual(self.module._get_session_row("session-token")["id"], 7)
                self.assertEqual(self.module._get_session_row("session-token")["id"], 7)
            self.assertEqual(calls, ["select"])
        finally:
            self.module._admin_session_cache.clear()
            self.module.ADMIN_SESSION_CACHE_TTL_SECONDS = original_ttl
            self.module.db_client = original_db

    def test_touch_session_is_throttled(self):
        updates = []

        class _TouchTable(_DummyTable):
            def update(self, payload):
                updates.append(payload)
                return self
            def eq(self, *a, **kw):
                return self

        class _DB:
            def table(self, name):
                return _TouchTable()

        original_db = self.module.db_client
        original_interval = self.module.ADMIN_SESSION_TOUCH_INTERVAL_SECONDS
        self.module.db_client = _DB()
        self.module.ADMIN_SESSION_TOUCH_INTERVAL_SECONDS = 300
        self.module._admin_session_last_touch_at.clear()
        try:
            with mock.patch.object(self.module.time, "time", side_effect=[1000, 1010, 1301]):
                self.module._touch_session({"id": 7})
                self.module._touch_session({"id": 7})
                self.module._touch_session({"id": 7})
            self.assertEqual(len(updates), 2)
        finally:
            self.module._admin_session_last_touch_at.clear()
            self.module.ADMIN_SESSION_TOUCH_INTERVAL_SECONDS = original_interval
            self.module.db_client = original_db

    def test_provider_defaults_to_empty_string(self):
        payload = {"timestamp": "2026-04-15T10:00:00Z", "model": "gpt-4o"}
        row = self.module._transform_queue_event(payload)
        self.assertIsNotNone(row)
        self.assertEqual(row["provider"], "")

    def test_provider_truncated_to_100_chars(self):
        payload = {
            "timestamp": "2026-04-15T10:00:00Z",
            "provider": "x" * 200,
        }
        row = self.module._transform_queue_event(payload)
        self.assertIsNotNone(row)
        self.assertLessEqual(len(row["provider"]), 100)

    def test_estimated_cost_usd_present_in_row(self):
        payload = {
            "timestamp": "2026-04-15T10:00:00Z",
            "model": "gpt-4o",
            "tokens": {"input_tokens": 1000, "output_tokens": 500, "total_tokens": 1500},
        }
        row = self.module._transform_queue_event(payload)
        self.assertIsNotNone(row)
        self.assertIn("estimated_cost_usd", row)
        self.assertIsInstance(row["estimated_cost_usd"], float)
        self.assertGreater(row["estimated_cost_usd"], 0)

    def test_estimated_cost_usd_zero_tokens(self):
        payload = {"timestamp": "2026-04-15T10:00:00Z", "model": "gpt-4o"}
        row = self.module._transform_queue_event(payload)
        self.assertIsNotNone(row)
        self.assertEqual(row["estimated_cost_usd"], 0.0)

    def test_estimated_cost_usd_unknown_model_uses_default(self):
        payload = {
            "timestamp": "2026-04-15T10:00:00Z",
            "model": "totally-unknown-model-xyz",
            "tokens": {"input_tokens": 1000, "output_tokens": 500},
        }
        row = self.module._transform_queue_event(payload)
        self.assertIsNotNone(row)
        self.assertGreaterEqual(row["estimated_cost_usd"], 0)

    def test_row_contains_all_required_fields(self):
        payload = {
            "timestamp": "2026-04-15T10:00:00Z",
            "model": "gpt-4o",
            "provider": "openai",
            "endpoint": "/v1/chat/completions",
            "request_id": "req-abc",
        }
        row = self.module._transform_queue_event(payload)
        for field in ("event_uid", "provider", "estimated_cost_usd", "model_name",
                      "api_endpoint", "occurred_at", "raw_detail", "ingested_at"):
            self.assertIn(field, row, f"missing field: {field}")


class FilterOptionsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = _load_module()

    def test_filter_options_empty_db(self):
        self.module.db_client = _DummyDB({"request_events": []})
        result = self.module._query_distinct_re_column("model_name")
        self.assertIsInstance(result, list)
        self.assertEqual(result, [])

    def test_filter_options_deduplicates_values(self):
        rows = [
            {"model_name": "gpt-4o"},
            {"model_name": "gpt-4o"},
            {"model_name": "claude-3.5-sonnet"},
            {"model_name": ""},
        ]
        self.module.db_client = _DummyDB({"request_events": rows})
        result = self.module._query_distinct_re_column("model_name")
        self.assertEqual(sorted(result), ["claude-3.5-sonnet", "gpt-4o"])

    def test_filter_options_no_db_client(self):
        original = self.module.db_client
        self.module.db_client = None
        try:
            result = self.module._query_distinct_re_column("provider")
            self.assertEqual(result, [])
        finally:
            self.module.db_client = original

    def test_filter_options_skips_empty_values(self):
        rows = [{"provider": ""}, {"provider": "openai"}, {"provider": None}]
        self.module.db_client = _DummyDB({"request_events": rows})
        result = self.module._query_distinct_re_column("provider")
        self.assertEqual(result, ["openai"])


class AggregateRequestEventsPythonTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = _load_module()

    def _make_db_with_rows(self, rows):
        class _TableWithData(_DummyTable):
            def execute(self_inner):
                return types.SimpleNamespace(data=rows)
        class _DB:
            def table(self_, name):
                if name == "request_events":
                    return _TableWithData()
                return _DummyTable()
        return _DB()

    def test_aggregate_groups_by_day(self):
        rows = [
            {
                "occurred_at": "2026-05-01T10:00:00+00:00",
                "failed": False,
                "input_tokens": 100, "output_tokens": 50, "reasoning_tokens": 0,
                "cached_tokens": 0, "total_tokens": 150, "estimated_cost_usd": 0.001,
                "latency_ms": 200, "model_name": "gpt-4o", "provider": "openai",
                "api_endpoint": "/v1/chat",
            },
            {
                "occurred_at": "2026-05-01T15:00:00+00:00",
                "failed": True,
                "input_tokens": 50, "output_tokens": 25, "reasoning_tokens": 0,
                "cached_tokens": 0, "total_tokens": 75, "estimated_cost_usd": 0.0005,
                "latency_ms": 300, "model_name": "gpt-4o", "provider": "openai",
                "api_endpoint": "/v1/chat",
            },
            {
                "occurred_at": "2026-05-02T08:00:00+00:00",
                "failed": False,
                "input_tokens": 200, "output_tokens": 100, "reasoning_tokens": 0,
                "cached_tokens": 0, "total_tokens": 300, "estimated_cost_usd": 0.002,
                "latency_ms": 150, "model_name": "claude-3.5-sonnet", "provider": "anthropic",
                "api_endpoint": "/v1/messages",
            },
        ]
        from datetime import datetime, timezone
        from_dt = datetime(2026, 5, 1, tzinfo=timezone.utc)
        to_dt = datetime(2026, 5, 3, tzinfo=timezone.utc)
        self.module.db_client = self._make_db_with_rows(rows)
        buckets = self.module._aggregate_request_events_python(from_dt, to_dt, "day", {})
        self.assertEqual(len(buckets), 2)
        day1 = next(b for b in buckets if "05-01" in b["bucket"])
        self.assertEqual(day1["request_count"], 2)
        self.assertEqual(day1["failed_count"], 1)
        self.assertEqual(day1["total_tokens"], 225)

    def test_aggregate_counts_request_event_window_rows_by_raw_detail(self):
        rows = [
            {
                "occurred_at": "2026-05-01T10:00:00+00:00",
                "failed": False,
                "input_tokens": 0,
                "output_tokens": 0,
                "reasoning_tokens": 0,
                "cached_tokens": 0,
                "total_tokens": 0,
                "estimated_cost_usd": 0,
                "latency_ms": 0,
                "model_name": "__request_events_aggregate__",
                "provider": "__request_events_aggregate__",
                "api_endpoint": "__request_events_aggregate__",
                "raw_detail": {
                    "aggregate": "request_events_upload_window",
                    "day": "2026-05-01",
                    "request_count": 5,
                    "failed_count": 2,
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "reasoning_tokens": 10,
                    "cached_tokens": 3,
                    "total_tokens": 160,
                    "estimated_cost_usd": 0.25,
                    "latency_sum_ms": 1200,
                    "latency_count": 5,
                },
            }
        ]
        from datetime import datetime, timezone
        from_dt = datetime(2026, 5, 1, tzinfo=timezone.utc)
        to_dt = datetime(2026, 5, 2, tzinfo=timezone.utc)
        self.module.db_client = self._make_db_with_rows(rows)
        buckets = self.module._aggregate_request_events_python(from_dt, to_dt, "day", {})
        self.assertEqual(len(buckets), 1)
        self.assertEqual(buckets[0]["request_count"], 5)
        self.assertEqual(buckets[0]["failed_count"], 2)
        self.assertEqual(buckets[0]["input_tokens"], 100)
        self.assertEqual(buckets[0]["output_tokens"], 50)
        self.assertEqual(buckets[0]["reasoning_tokens"], 10)
        self.assertEqual(buckets[0]["cached_tokens"], 3)
        self.assertEqual(buckets[0]["total_tokens"], 160)
        self.assertEqual(buckets[0]["estimated_cost_usd"], 0.25)
        self.assertEqual(buckets[0]["avg_latency_ms"], 240)

    def test_aggregate_groups_by_hour(self):
        rows = [
            {
                "occurred_at": "2026-05-01T10:00:00+00:00",
                "failed": False, "input_tokens": 100, "output_tokens": 50,
                "reasoning_tokens": 0, "cached_tokens": 0, "total_tokens": 150,
                "estimated_cost_usd": 0.001, "latency_ms": 100,
                "model_name": "gpt-4o", "provider": "openai", "api_endpoint": "/v1/chat",
            },
            {
                "occurred_at": "2026-05-01T11:00:00+00:00",
                "failed": False, "input_tokens": 200, "output_tokens": 100,
                "reasoning_tokens": 0, "cached_tokens": 0, "total_tokens": 300,
                "estimated_cost_usd": 0.002, "latency_ms": 200,
                "model_name": "gpt-4o", "provider": "openai", "api_endpoint": "/v1/chat",
            },
        ]
        from datetime import datetime, timezone
        from_dt = datetime(2026, 5, 1, tzinfo=timezone.utc)
        to_dt = datetime(2026, 5, 2, tzinfo=timezone.utc)
        self.module.db_client = self._make_db_with_rows(rows)
        buckets = self.module._aggregate_request_events_python(from_dt, to_dt, "hour", {})
        self.assertEqual(len(buckets), 2)

    def test_aggregate_filters_by_provider(self):
        rows = [
            {
                "occurred_at": "2026-05-01T10:00:00+00:00",
                "failed": False, "input_tokens": 100, "output_tokens": 50,
                "reasoning_tokens": 0, "cached_tokens": 0, "total_tokens": 150,
                "estimated_cost_usd": 0.001, "latency_ms": 100,
                "model_name": "gpt-4o", "provider": "openai", "api_endpoint": "/v1/chat",
            },
            {
                "occurred_at": "2026-05-01T10:30:00+00:00",
                "failed": False, "input_tokens": 200, "output_tokens": 100,
                "reasoning_tokens": 0, "cached_tokens": 0, "total_tokens": 300,
                "estimated_cost_usd": 0.002, "latency_ms": 200,
                "model_name": "claude-3.5-sonnet", "provider": "anthropic", "api_endpoint": "/v1/messages",
            },
        ]

        class _FilteredTable(_DummyTable):
            def __init__(self, rows_all):
                self._rows_all = rows_all
                self._filters = {}
            def eq(self, col, val):
                self._filters[col] = val
                return self
            def gte(self, *a, **kw):
                return self
            def lt(self, *a, **kw):
                return self
            def limit(self, *a, **kw):
                return self
            def select(self, *a, **kw):
                return self
            def execute(self):
                filtered = [
                    r for r in self._rows_all
                    if all(r.get(k) == v for k, v in self._filters.items())
                ]
                return types.SimpleNamespace(data=filtered)

        class _FilterDB:
            def __init__(self, rows_all):
                self._rows = rows_all
            def table(self, name):
                if name == "request_events":
                    return _FilteredTable(self._rows)
                return _DummyTable()

        from datetime import datetime, timezone
        from_dt = datetime(2026, 5, 1, tzinfo=timezone.utc)
        to_dt = datetime(2026, 5, 2, tzinfo=timezone.utc)
        self.module.db_client = _FilterDB(rows)
        buckets = self.module._aggregate_request_events_python(
            from_dt, to_dt, "day", {"provider": "openai"}
        )
        total_requests = sum(b["request_count"] for b in buckets)
        self.assertEqual(total_requests, 1)

    def test_aggregate_empty_result_when_no_rows(self):
        from datetime import datetime, timezone
        from_dt = datetime(2026, 5, 1, tzinfo=timezone.utc)
        to_dt = datetime(2026, 5, 2, tzinfo=timezone.utc)
        self.module.db_client = self._make_db_with_rows([])
        buckets = self.module._aggregate_request_events_python(from_dt, to_dt, "day", {})
        self.assertEqual(buckets, [])

    def test_aggregate_cost_rounded_to_6_places(self):
        rows = [{
            "occurred_at": "2026-05-01T10:00:00+00:00",
            "failed": False, "input_tokens": 1, "output_tokens": 1,
            "reasoning_tokens": 0, "cached_tokens": 0, "total_tokens": 2,
            "estimated_cost_usd": 0.123456789, "latency_ms": 0,
            "model_name": "gpt-4o", "provider": "openai", "api_endpoint": "/v1/chat",
        }]
        from datetime import datetime, timezone
        from_dt = datetime(2026, 5, 1, tzinfo=timezone.utc)
        to_dt = datetime(2026, 5, 2, tzinfo=timezone.utc)
        self.module.db_client = self._make_db_with_rows(rows)
        buckets = self.module._aggregate_request_events_python(from_dt, to_dt, "day", {})
        self.assertEqual(len(buckets), 1)
        cost_str = str(buckets[0]["estimated_cost_usd"])
        decimal_places = len(cost_str.split(".")[-1]) if "." in cost_str else 0
        self.assertLessEqual(decimal_places, 6)

    def test_aggregate_default_query_prefers_aggregate_rows(self):
        calls = []

        class _TrackingTable(_DummyTable):
            def __init__(self):
                self._filters = {}
                self._limit = None
            def select(self, *a, **kw):
                return self
            def gte(self, *a, **kw):
                return self
            def lt(self, *a, **kw):
                return self
            def eq(self, col, val):
                self._filters[col] = val
                return self
            def limit(self, value):
                self._limit = value
                return self
            def execute(self):
                calls.append({"filters": dict(self._filters), "limit": self._limit})
                return types.SimpleNamespace(data=[{
                    "occurred_at": "2026-05-01T10:00:00+00:00",
                    "failed": False,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "reasoning_tokens": 0,
                    "cached_tokens": 0,
                    "total_tokens": 0,
                    "estimated_cost_usd": 0,
                    "latency_ms": 0,
                    "api_endpoint": "__request_events_aggregate__",
                    "raw_detail": {
                        "aggregate": "request_events_upload_window",
                        "day": "2026-05-01",
                        "request_count": 3,
                        "failed_count": 0,
                        "total_tokens": 42,
                    },
                }])

        class _DB:
            def table(self, name):
                return _TrackingTable()

        from datetime import datetime, timezone
        self.module.db_client = _DB()
        buckets = self.module._aggregate_request_events_python(
            datetime(2026, 5, 1, tzinfo=timezone.utc),
            datetime(2026, 5, 2, tzinfo=timezone.utc),
            "day",
            {},
        )
        self.assertEqual(calls[0]["filters"], {"api_endpoint": "__request_events_aggregate__"})
        self.assertEqual(calls[0]["limit"], 10000)
        self.assertEqual(len(calls), 1)
        self.assertEqual(buckets[0]["request_count"], 3)
        self.assertEqual(buckets[0]["models"], {})

    def test_aggregate_default_query_preserves_breakdown_maps(self):
        class _TrackingTable(_DummyTable):
            def __init__(self):
                self._filters = {}
            def select(self, *a, **kw):
                return self
            def gte(self, *a, **kw):
                return self
            def lt(self, *a, **kw):
                return self
            def eq(self, col, val):
                self._filters[col] = val
                return self
            def limit(self, value):
                return self
            def execute(self):
                return types.SimpleNamespace(data=[{
                    "occurred_at": "2026-05-01T10:00:00+00:00",
                    "failed": False,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "reasoning_tokens": 0,
                    "cached_tokens": 0,
                    "total_tokens": 0,
                    "estimated_cost_usd": 0,
                    "latency_ms": 0,
                    "api_endpoint": "__request_events_aggregate__",
                    "raw_detail": {
                        "aggregate": "request_events_upload_window",
                        "day": "2026-05-01",
                        "request_count": 2,
                        "failed_count": 1,
                        "total_tokens": 30,
                        "models": {"gpt-4o": {"requests": 2, "success": 1, "failure": 1, "tokens": 30, "cost": 0.5}},
                        "providers": {"openai": {"requests": 2, "success": 1, "failure": 1, "tokens": 30, "cost": 0.5}},
                        "auth_models": {"auth-1\u001fgpt-4o": {"auth": "auth-1", "model": "gpt-4o", "requests": 2, "success": 1, "failure": 1, "tokens": 30, "cost": 0.5}},
                        "source_models": {"source-1\u001fgpt-4o": {"source": "source-1", "auth": "auth-1", "provider": "openai", "model": "gpt-4o", "requests": 2, "success": 1, "failure": 1, "tokens": 30, "cost": 0.5}},
                        "endpoints": {"/v1/chat": {"requests": 2, "success": 1, "failure": 1, "tokens": 30, "cost": 0.5, "models": {"gpt-4o": {"requests": 2, "success": 1, "failure": 1, "tokens": 30, "cost": 0.5}}}},
                    },
                }])

        class _DB:
            def table(self, name):
                return _TrackingTable()

        from datetime import datetime, timezone
        self.module.db_client = _DB()
        buckets = self.module._aggregate_request_events_python(
            datetime(2026, 5, 1, tzinfo=timezone.utc),
            datetime(2026, 5, 2, tzinfo=timezone.utc),
            "day",
            {},
        )
        self.assertEqual(buckets[0]["models"]["gpt-4o"]["requests"], 2)
        self.assertEqual(buckets[0]["providers"]["openai"]["tokens"], 30)
        self.assertEqual(buckets[0]["auth_models"]["auth-1\u001fgpt-4o"]["auth"], "auth-1")
        self.assertEqual(buckets[0]["source_models"]["source-1\u001fgpt-4o"]["provider"], "openai")
        self.assertEqual(buckets[0]["endpoints"]["/v1/chat"]["models"]["gpt-4o"]["requests"], 2)

    def test_aggregate_default_query_raw_fallback_is_limited(self):
        calls = []

        class _TrackingTable(_DummyTable):
            def __init__(self):
                self._filters = {}
                self._limit = None
            def select(self, *a, **kw):
                return self
            def gte(self, *a, **kw):
                return self
            def lt(self, *a, **kw):
                return self
            def eq(self, col, val):
                self._filters[col] = val
                return self
            def limit(self, value):
                self._limit = value
                return self
            def execute(self):
                calls.append({"filters": dict(self._filters), "limit": self._limit})
                if len(calls) == 1:
                    return types.SimpleNamespace(data=[])
                return types.SimpleNamespace(data=[])

        class _DB:
            def table(self, name):
                return _TrackingTable()

        from datetime import datetime, timezone
        self.module.db_client = _DB()
        buckets = self.module._aggregate_request_events_python(
            datetime(2026, 5, 1, tzinfo=timezone.utc),
            datetime(2026, 5, 2, tzinfo=timezone.utc),
            "day",
            {},
        )
        self.assertEqual(calls[0]["filters"], {"api_endpoint": "__request_events_aggregate__"})
        self.assertEqual(calls[1]["filters"], {})
        self.assertEqual(calls[1]["limit"], 1000)
        self.assertEqual(buckets, [])


class RequestEventsAggregateCacheTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = _load_module()

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._original_cache_dir = self.module.REQUEST_EVENTS_AGGREGATE_CACHE_DIR
        self._original_ttl = self.module.REQUEST_EVENTS_AGGREGATE_CACHE_TTL_SECONDS
        self.module.REQUEST_EVENTS_AGGREGATE_CACHE_DIR = Path(self._tmpdir.name)
        self.module.REQUEST_EVENTS_AGGREGATE_CACHE_TTL_SECONDS = 300

    def tearDown(self):
        self.module.REQUEST_EVENTS_AGGREGATE_CACHE_DIR = self._original_cache_dir
        self.module.REQUEST_EVENTS_AGGREGATE_CACHE_TTL_SECONDS = self._original_ttl
        self._tmpdir.cleanup()

    def test_cache_key_is_deterministic(self):
        from datetime import datetime, timezone
        from_dt = datetime(2026, 5, 1, tzinfo=timezone.utc)
        to_dt = datetime(2026, 5, 2, tzinfo=timezone.utc)
        first = self.module._request_events_aggregate_cache_key(from_dt, to_dt, "day", {"provider": "openai"})
        second = self.module._request_events_aggregate_cache_key(from_dt, to_dt, "day", {"provider": "openai"})
        self.assertEqual(first, second)

    def test_ceil_datetime_to_bucket_stabilizes_live_to(self):
        from datetime import datetime, timezone
        value = datetime(2026, 5, 1, 10, 2, 3, tzinfo=timezone.utc)
        bucketed = self.module._ceil_datetime_to_bucket(value, 300)
        self.assertEqual(bucketed.isoformat(), "2026-05-01T10:05:00+00:00")

    def test_ceil_datetime_to_bucket_keeps_boundary(self):
        from datetime import datetime, timezone
        value = datetime(2026, 5, 1, 10, 5, 0, tzinfo=timezone.utc)
        bucketed = self.module._ceil_datetime_to_bucket(value, 300)
        self.assertEqual(bucketed.isoformat(), "2026-05-01T10:05:00+00:00")

    def test_cache_write_and_read_hit(self):
        payload = {"granularity": "day", "buckets": [{"request_count": 2}]}
        self.module._write_request_events_aggregate_cache("abc", payload)
        self.assertEqual(self.module._read_request_events_aggregate_cache("abc"), payload)

    def test_cache_expired_returns_none(self):
        payload = {"granularity": "day", "buckets": []}
        self.module._write_request_events_aggregate_cache("old", payload)
        self.module.REQUEST_EVENTS_AGGREGATE_CACHE_TTL_SECONDS = 1
        cache_path = self.module.REQUEST_EVENTS_AGGREGATE_CACHE_DIR / "old.json"
        old_time = 1000
        import os
        os.utime(cache_path, (old_time, old_time))
        self.assertIsNone(self.module._read_request_events_aggregate_cache("old"))

    def test_clear_cache_removes_json_files(self):
        self.module._write_request_events_aggregate_cache("a", {"buckets": []})
        self.module._write_request_events_aggregate_cache("b", {"buckets": []})
        self.module._clear_request_events_aggregate_cache()
        self.assertEqual(list(self.module.REQUEST_EVENTS_AGGREGATE_CACHE_DIR.glob("*.json")), [])


class PriceSettingsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = _load_module()

    def test_price_settings_includes_default_pricing(self):
        self.module.db_client = _DummyDB({"model_pricing": []})
        result = self.module.request_events_price_settings()
        self.assertIn("default_pricing", result)
        self.assertIn("default_fallback", result)
        self.assertIsInstance(result["default_pricing"], list)

    def test_price_settings_includes_db_pricing(self):
        db_rows = [
            {
                "id": 1,
                "model_pattern": "gpt-4o",
                "input_price_per_million": 2.50,
                "output_price_per_million": 10.00,
                "provider": "openai",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        ]
        self.module.db_client = _DummyDB({"model_pricing": db_rows})
        result = self.module.request_events_price_settings()
        self.assertEqual(len(result["db_pricing"]), 1)
        self.assertEqual(result["db_pricing"][0]["model_pattern"], "gpt-4o")

    def test_price_settings_default_fallback_has_input_output(self):
        self.module.db_client = _DummyDB({"model_pricing": []})
        result = self.module.request_events_price_settings()
        fallback = result["default_fallback"]
        self.assertIn("input", fallback)
        self.assertIn("output", fallback)

    def test_fetch_remote_pricing_uses_openrouter_model_prices(self):
        class _Response:
            def raise_for_status(self):
                pass

            def json(self):
                return {
                    "data": [
                        {
                            "id": "openai/gpt-4o-mini",
                            "owned_by": "openai",
                            "pricing": {
                                "prompt": "0.00000015",
                                "completion": "0.0000006",
                            },
                        },
                        {
                            "id": "broken",
                            "pricing": {"prompt": "not-a-number", "completion": "0"},
                        },
                    ]
                }

        self.module.remote_pricing_cache = {}
        self.module.remote_pricing_last_fetch = 0
        original_get = self.module.requests.get
        try:
            calls = []

            def fake_get(url, **kwargs):
                calls.append((url, kwargs))
                return _Response()

            self.module.requests.get = fake_get
            pricing = self.module.fetch_remote_pricing()
        finally:
            self.module.requests.get = original_get

        self.assertEqual(calls[0][0], "https://openrouter.ai/api/v1/models")
        self.assertEqual(pricing["openai/gpt-4o-mini"]["input"], 0.15)
        self.assertEqual(pricing["openai/gpt-4o-mini"]["output"], 0.6)
        self.assertEqual(pricing["openai/gpt-4o-mini"]["vendor"], "openai")
        self.assertNotIn("broken", pricing)


class ValidGranularityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = _load_module()

    def test_valid_granularities_are_correct_set(self):
        valid = self.module._VALID_RE_GRANULARITIES
        self.assertIn("hour", valid)
        self.assertIn("day", valid)
        self.assertIn("week", valid)
        self.assertNotIn("minute", valid)
        self.assertNotIn("month", valid)


if __name__ == "__main__":
    unittest.main()
