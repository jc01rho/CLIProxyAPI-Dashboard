"""Tests for Redis queue event ingestion: payload parsing, transformation, redaction, dedup."""

import hashlib
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
    flask.jsonify = lambda x=None, *a, **kw: x if x is not None else {}
    flask.make_response = lambda x: x
    flask.request = types.SimpleNamespace(
        headers={}, path="/", method="GET", host_url="http://localhost/", cookies={}
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
    _install_dependency_stubs()
    spec = importlib.util.spec_from_file_location("collector_main_redis_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class _DummyTable:
    def select(self, *a, **kw):
        return self
    def eq(self, *a, **kw):
        return self
    def neq(self, *a, **kw):
        return self
    def lt(self, *a, **kw):
        return self
    def limit(self, *a, **kw):
        return self
    def upsert(self, *a, **kw):
        return self
    def insert(self, *a, **kw):
        return self
    def execute(self):
        return types.SimpleNamespace(data=[])


class _DummyDB:
    def table(self, *a, **kw):
        return _DummyTable()


class RedisQueueTransformTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = _load_module()

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._original_spool_path = self.module.REQUEST_EVENTS_SPOOL_PATH
        self.module.REQUEST_EVENTS_SPOOL_PATH = Path(self._tmpdir.name) / "request_events_spool.jsonl"
        self.module._reset_request_event_upload_state()

    def tearDown(self):
        self.module._reset_request_event_upload_state()
        self.module.REQUEST_EVENTS_SPOOL_PATH = self._original_spool_path
        self._tmpdir.cleanup()

    def test_transform_complete_payload(self):
        payload = {
            "timestamp": "2026-04-15T10:30:00Z",
            "latency_ms": 150,
            "source": "sk-abcdef1234567890",
            "auth_index": "0",
            "tokens": {
                "input_tokens": 100,
                "output_tokens": 50,
                "reasoning_tokens": 10,
                "cached_tokens": 20,
                "total_tokens": 180,
            },
            "failed": False,
            "provider": "openai",
            "model": "gpt-4o",
            "endpoint": "/v1/chat/completions",
            "auth_type": "bearer",
            "api_key": "sk-secret-key-12345678",
            "request_id": "req-abc123",
        }
        row = self.module._transform_queue_event(payload)
        self.assertIsNotNone(row)
        self.assertEqual(row["model_name"], "gpt-4o")
        self.assertEqual(row["api_endpoint"], "/v1/chat/completions")
        self.assertEqual(row["latency_ms"], 150)
        self.assertFalse(row["failed"])
        self.assertEqual(row["input_tokens"], 100)
        self.assertEqual(row["output_tokens"], 50)
        self.assertEqual(row["reasoning_tokens"], 10)
        self.assertEqual(row["cached_tokens"], 20)
        self.assertEqual(row["total_tokens"], 180)
        self.assertEqual(row["request_id"], "req-abc123")
        self.assertEqual(row["auth_index"], "0")
        self.assertIsNone(row["snapshot_id"])

    def test_api_key_redacted_in_raw_detail(self):
        payload = {
            "timestamp": "2026-04-15T10:30:00Z",
            "api_key": "sk-this-is-a-secret-key-12345678",
            "source": "credential-abc",
            "request_id": "r1",
        }
        row = self.module._transform_queue_event(payload)
        self.assertIsNotNone(row)
        raw = row["raw_detail"]
        self.assertNotIn("sk-this-is-a-secret-key-12345678", raw.get("api_key", ""))
        self.assertIn("***", raw.get("api_key", ""))

    def test_source_redacted_in_row_and_raw_detail(self):
        payload = {
            "timestamp": "2026-04-15T10:30:00Z",
            "source": "long-source-id-12345678",
        }
        row = self.module._transform_queue_event(payload)
        self.assertIsNotNone(row)
        self.assertNotEqual(row["source_id"], "long-source-id-12345678")
        self.assertIn("***", row["source_id"])
        raw_source = row["raw_detail"].get("source", "")
        self.assertNotIn("long-source-id-12345678", raw_source)

    def test_event_uid_deterministic_with_request_id(self):
        payload = {
            "timestamp": "2026-04-15T10:30:00Z",
            "request_id": "req-unique-123",
        }
        uid1 = self.module._generate_redis_event_uid(payload)
        uid2 = self.module._generate_redis_event_uid(payload)
        self.assertEqual(uid1, uid2)
        self.assertFalse(uid1.startswith("rq:"), "uid must not have rq: prefix")
        self.assertEqual(len(uid1), 64, "uid must be a sha256 hex digest")

    def test_event_uid_stable_without_request_id(self):
        payload = {
            "timestamp": "2026-04-15T10:30:00Z",
            "endpoint": "/v1/chat",
            "model": "gpt-4",
            "source": "sk-abc",
            "auth_index": "0",
            "latency_ms": 100,
        }
        uid1 = self.module._generate_redis_event_uid(payload)
        uid2 = self.module._generate_redis_event_uid(payload)
        self.assertEqual(uid1, uid2)
        self.assertFalse(uid1.startswith("rq:"), "uid must not have rq: prefix")

    def test_event_uid_no_prefix_matches_management_uid_formula(self):
        import hashlib
        endpoint = "/v1/chat/completions"
        model = "gpt-4o"
        source = "sk-test"
        auth_index = "0"
        occurred_at_str = "2026-04-15T10:30:00+00:00"
        from datetime import datetime, timezone
        occurred_at = datetime(2026, 4, 15, 10, 30, 0, tzinfo=timezone.utc)
        management_key = f"{endpoint}|{model}|{source}|{occurred_at.isoformat()}|{auth_index}"
        expected_uid = hashlib.sha256(management_key.encode("utf-8")).hexdigest()

        queue_payload = {
            "timestamp": occurred_at_str,
            "endpoint": endpoint,
            "model": model,
            "source": source,
            "auth_index": auth_index,
        }
        got_uid = self.module._generate_redis_event_uid(queue_payload)
        self.assertEqual(got_uid, expected_uid)

    def test_event_uid_different_for_different_request_ids(self):
        p1 = {"timestamp": "2026-04-15T10:30:00Z", "request_id": "req-a"}
        p2 = {"timestamp": "2026-04-15T10:30:00Z", "request_id": "req-b"}
        self.assertNotEqual(
            self.module._generate_redis_event_uid(p1),
            self.module._generate_redis_event_uid(p2),
        )

    def test_total_tokens_computed_when_zero(self):
        payload = {
            "timestamp": "2026-04-15T10:30:00Z",
            "tokens": {
                "input_tokens": 50,
                "output_tokens": 30,
                "reasoning_tokens": 5,
                "total_tokens": 0,
            },
        }
        row = self.module._transform_queue_event(payload)
        self.assertEqual(row["total_tokens"], 85)

    def test_transform_returns_none_for_non_dict(self):
        self.assertIsNone(self.module._transform_queue_event("not a dict"))
        self.assertIsNone(self.module._transform_queue_event(42))
        self.assertIsNone(self.module._transform_queue_event(None))

    def test_transform_handles_missing_tokens(self):
        payload = {"timestamp": "2026-04-15T10:30:00Z"}
        row = self.module._transform_queue_event(payload)
        self.assertIsNotNone(row)
        self.assertEqual(row["input_tokens"], 0)
        self.assertEqual(row["output_tokens"], 0)
        self.assertEqual(row["total_tokens"], 0)

    def test_transform_truncates_long_strings(self):
        payload = {
            "timestamp": "2026-04-15T10:30:00Z",
            "endpoint": "x" * 500,
            "model": "m" * 500,
        }
        row = self.module._transform_queue_event(payload)
        self.assertLessEqual(len(row["api_endpoint"]), 255)
        self.assertLessEqual(len(row["model_name"]), 255)

    def test_redis_queue_sync_no_addr_returns_empty(self):
        original = self.module.REDIS_QUEUE_ADDR
        self.module.REDIS_QUEUE_ADDR = ""
        self.module.db_client = _DummyDB()
        result = self.module._redis_queue_sync_once()
        self.assertEqual(result["popped"], 0)
        self.module.REDIS_QUEUE_ADDR = original

    def test_sync_mode_routing(self):
        self.module.REDIS_QUEUE_ADDR = "redis://localhost:6379"

        self.module.USAGE_SYNC_MODE = "management"
        self.assertFalse(self.module._should_use_redis_queue())
        self.assertTrue(self.module._should_use_management_polling())

        self.module.USAGE_SYNC_MODE = "redis"
        self.assertTrue(self.module._should_use_redis_queue())
        self.assertFalse(self.module._should_use_management_polling())

        self.module.USAGE_SYNC_MODE = "queue"
        self.assertFalse(self.module._should_use_redis_queue())
        self.assertFalse(self.module._should_use_management_polling())
        self.assertTrue(self.module._should_use_usage_queue())

        self.module.USAGE_SYNC_MODE = "auto"
        self.assertTrue(self.module._should_use_redis_queue())
        self.assertFalse(self.module._should_use_management_polling())
        self.assertTrue(self.module._should_use_usage_queue())

        self.module.USAGE_SYNC_MODE = "auto"
        self.module.REDIS_QUEUE_ADDR = ""
        self.assertFalse(self.module._should_use_redis_queue())
        self.assertFalse(self.module._should_use_management_polling())

        self.module.REDIS_QUEUE_ADDR = "redis://localhost:6379"

    def test_fetch_usage_queue_items_parses_management_response(self):
        class _Response:
            status_code = 200
            content = b'{"items":[]}'

            def raise_for_status(self):
                return None

            def json(self):
                return {"count": 1, "items": [{"request_id": "req-http", "model": "gpt-5.4"}]}

        calls = []

        def fake_get(url, headers=None, params=None, timeout=None):
            calls.append({"url": url, "headers": headers, "params": params, "timeout": timeout})
            return _Response()

        original_get = self.module.requests.get
        original_url = self.module.CLIPROXY_URL
        original_key = self.module.CLIPROXY_MANAGEMENT_KEY
        self.module.requests.get = fake_get
        self.module.CLIPROXY_URL = "http://cliproxy.local"
        self.module.CLIPROXY_MANAGEMENT_KEY = "management-secret"
        try:
            items, meta = self.module.fetch_usage_queue_items(25)
            self.assertEqual(items, [{"request_id": "req-http", "model": "gpt-5.4"}])
            self.assertEqual(meta["http_status"], 200)
            self.assertEqual(calls[0]["url"], "http://cliproxy.local/v0/management/usage-queue")
            self.assertEqual(calls[0]["params"], {"count": 25})
            self.assertEqual(calls[0]["headers"], {"Authorization": "Bearer management-secret"})
        finally:
            self.module.requests.get = original_get
            self.module.CLIPROXY_URL = original_url
            self.module.CLIPROXY_MANAGEMENT_KEY = original_key

    def test_fetch_usage_queue_items_parses_plus_array_response(self):
        class _Response:
            status_code = 200
            content = b'[{"request_id":"req-array","model":"gpt-5.4"}]'

            def raise_for_status(self):
                return None

            def json(self):
                return [{"request_id": "req-array", "model": "gpt-5.4"}]

        original_get = self.module.requests.get
        original_url = self.module.CLIPROXY_URL
        self.module.requests.get = lambda *a, **kw: _Response()
        self.module.CLIPROXY_URL = "http://cliproxy.local"
        try:
            items, meta = self.module.fetch_usage_queue_items(25)
            self.assertEqual(items, [{"request_id": "req-array", "model": "gpt-5.4"}])
            self.assertEqual(meta["count"], 1)
            self.assertEqual(meta["http_status"], 200)
        finally:
            self.module.requests.get = original_get
            self.module.CLIPROXY_URL = original_url

    def test_usage_queue_sync_fetches_and_persists(self):
        events = []

        class _RecordingTable(_DummyTable):
            def upsert(self, data, on_conflict=None):
                events.extend(data if isinstance(data, list) else [data])
                return self

        class _RecordingDB:
            def table(self, *a, **kw):
                return _RecordingTable()

        original_fetch = self.module.fetch_usage_queue_items
        original_available = self.module._request_events_table_available
        self.module.db_client = _RecordingDB()
        self.module._request_events_table_available = True
        self.module.fetch_usage_queue_items = lambda count: ([{
            "timestamp": "2026-04-15T10:30:00Z",
            "request_id": "req-http-sync",
            "model": "gpt-5.4",
            "endpoint": "/v1/chat/completions",
            "tokens": {"input_tokens": 3, "output_tokens": 4, "total_tokens": 7},
        }], {"count": 1})
        try:
            result = self.module._usage_queue_sync_once()
            self.assertEqual(result["popped"], 1)
            self.assertEqual(result["parsed"], 1)
            self.assertEqual(result["persisted"], 0)
            self.assertTrue(result["upload_deferred"])
            self.assertEqual(len(events), 0)

            flush = self.module._flush_request_event_upload_buffer("scheduled", force=True)
            self.assertTrue(flush["flushed"])
            self.assertEqual(flush["persisted"], 1)
            self.assertEqual(flush["aggregated_events"], 1)
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["api_endpoint"], "__request_events_aggregate__")
            self.assertEqual(events[0]["raw_detail"]["request_count"], 1)
            self.assertEqual(len(events[0]["raw_detail"]["event_uids"]), 1)
            model_stats = events[0]["raw_detail"]["models"]["gpt-5.4"]
            self.assertEqual(model_stats["input_tokens"], 3)
            self.assertEqual(model_stats["output_tokens"], 4)
            self.assertEqual(model_stats["tokens"], 7)
            auth_model_stats = next(iter(events[0]["raw_detail"]["auth_models"].values()))
            self.assertEqual(auth_model_stats["input_tokens"], 3)
            self.assertEqual(auth_model_stats["output_tokens"], 4)
            self.assertEqual(auth_model_stats["tokens"], 7)
        finally:
            self.module.fetch_usage_queue_items = original_fetch
            self.module._request_events_table_available = original_available

    def test_usage_queue_sync_skips_drain_when_request_events_missing(self):
        class _MissingTableError(Exception):
            def __init__(self):
                super().__init__({
                    "code": "PGRST205",
                    "message": "Could not find the table 'public.request_events' in the schema cache",
                })

        class _MissingTable:
            def select(self, *a, **kw):
                return self
            def limit(self, *a, **kw):
                return self
            def execute(self):
                raise _MissingTableError()

        class _MissingDB:
            def table(self, name):
                self.name = name
                return _MissingTable()

        calls = []
        original_fetch = self.module.fetch_usage_queue_items
        original_db = self.module.db_client
        original_available = self.module._request_events_table_available
        original_warned = self.module._request_events_table_warned
        original_next_check = self.module._request_events_next_check_at
        self.module.db_client = _MissingDB()
        self.module._request_events_table_available = None
        self.module._request_events_table_warned = False
        self.module._request_events_next_check_at = 0
        self.module.fetch_usage_queue_items = lambda count: calls.append(count) or ([{"request_id": "lost"}], {})
        try:
            result = self.module._usage_queue_sync_once()
            self.assertEqual(result["popped"], 0)
            self.assertEqual(calls, [])
            self.assertFalse(self.module._request_events_table_available)
            self.assertTrue(self.module._request_events_table_warned)
            self.assertGreater(self.module._request_events_next_check_at, 0)
        finally:
            self.module.fetch_usage_queue_items = original_fetch
            self.module.db_client = original_db
            self.module._request_events_table_available = original_available
            self.module._request_events_table_warned = original_warned
            self.module._request_events_next_check_at = original_next_check

    def test_usage_queue_sync_throttles_missing_table_rechecks(self):
        calls = []

        class _UnexpectedDB:
            def table(self, name):
                calls.append(name)
                raise AssertionError("availability check should be throttled")

        original_db = self.module.db_client
        original_available = self.module._request_events_table_available
        original_next_check = self.module._request_events_next_check_at
        self.module.db_client = _UnexpectedDB()
        self.module._request_events_table_available = False
        self.module._request_events_next_check_at = self.module.time.time() + 60
        try:
            result = self.module._usage_queue_sync_once()
            self.assertEqual(result["popped"], 0)
            self.assertEqual(calls, [])
        finally:
            self.module.db_client = original_db
            self.module._request_events_table_available = original_available
            self.module._request_events_next_check_at = original_next_check

    def test_usage_queue_drain_loop_runs_until_empty(self):
        events = []
        call_count = [0]
        batch_size = 2
        all_batches = [
            [{"timestamp": "2026-04-15T10:30:00Z", "request_id": f"req-{i}", "model": "gpt-4o"}
             for i in range(batch_size)],
            [{"timestamp": "2026-04-15T10:30:01Z", "request_id": f"req-{batch_size + j}", "model": "gpt-4o"}
             for j in range(batch_size)],
            [],
        ]

        class _RecordingTable(_DummyTable):
            def upsert(self, data, on_conflict=None):
                events.extend(data if isinstance(data, list) else [data])
                return self

        class _RecordingDB:
            def table(self, *a, **kw):
                return _RecordingTable()

        def fake_fetch(count):
            idx = call_count[0]
            call_count[0] += 1
            batch = all_batches[min(idx, len(all_batches) - 1)]
            return batch, {"count": len(batch)}

        original_fetch = self.module.fetch_usage_queue_items
        original_batch_size = self.module.USAGE_QUEUE_BATCH_SIZE
        original_available = self.module._request_events_table_available
        self.module.db_client = _RecordingDB()
        self.module._request_events_table_available = True
        self.module.fetch_usage_queue_items = fake_fetch
        self.module.USAGE_QUEUE_BATCH_SIZE = batch_size
        try:
            result = self.module._usage_queue_sync_once()
            self.assertEqual(result["popped"], batch_size * 2)
            self.assertEqual(result["persisted"], 0)
            self.assertTrue(result["upload_deferred"])
            self.assertEqual(len(events), 0)

            flush = self.module._flush_request_event_upload_buffer("scheduled", force=True)
            self.assertEqual(flush["persisted"], 1)
            self.assertEqual(flush["aggregated_events"], batch_size * 2)
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["raw_detail"]["request_count"], batch_size * 2)
        finally:
            self.module.fetch_usage_queue_items = original_fetch
            self.module.USAGE_QUEUE_BATCH_SIZE = original_batch_size
            self.module._request_events_table_available = original_available

    def test_usage_queue_first_run_buffers_all_drained_events_until_upload_window(self):
        events = []
        call_count = [0]
        batch_size = 2
        all_batches = [
            [{"timestamp": "2026-04-15T10:30:00Z", "request_id": f"startup-{i}", "model": "gpt-4o"}
             for i in range(batch_size)],
            [{"timestamp": "2026-04-15T10:30:01Z", "request_id": f"startup-{batch_size + j}", "model": "gpt-4o"}
             for j in range(batch_size)],
            [],
        ]

        class _RecordingTable(_DummyTable):
            def upsert(self, data, on_conflict=None):
                events.extend(data if isinstance(data, list) else [data])
                return self

        class _RecordingDB:
            def table(self, *a, **kw):
                return _RecordingTable()

        def fake_fetch(count):
            idx = call_count[0]
            call_count[0] += 1
            batch = all_batches[min(idx, len(all_batches) - 1)]
            return batch, {"count": len(batch)}

        original_fetch = self.module.fetch_usage_queue_items
        original_batch_size = self.module.USAGE_QUEUE_BATCH_SIZE
        original_available = self.module._request_events_table_available
        self.module.db_client = _RecordingDB()
        self.module._request_events_table_available = True
        self.module.fetch_usage_queue_items = fake_fetch
        self.module.USAGE_QUEUE_BATCH_SIZE = batch_size
        try:
            result = self.module._usage_queue_sync_once()
            self.assertEqual(result["popped"], batch_size * 2)
            self.assertEqual(result["persisted"], 0)
            self.assertTrue(result["upload_deferred"])
            self.assertEqual(len(events), 0)

            flush = self.module._flush_request_event_upload_buffer("scheduled", force=True)
            self.assertEqual(flush["persisted"], 1)
            self.assertEqual(flush["aggregated_events"], batch_size * 2)
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["raw_detail"]["request_count"], batch_size * 2)
        finally:
            self.module.fetch_usage_queue_items = original_fetch
            self.module.USAGE_QUEUE_BATCH_SIZE = original_batch_size
            self.module._request_events_table_available = original_available

    def test_usage_queue_subsequent_run_defers_upload_until_interval(self):
        events = []

        class _RecordingTable(_DummyTable):
            def upsert(self, data, on_conflict=None):
                events.extend(data if isinstance(data, list) else [data])
                return self

        class _RecordingDB:
            def table(self, *a, **kw):
                return _RecordingTable()

        original_fetch = self.module.fetch_usage_queue_items
        original_available = self.module._request_events_table_available
        self.module.db_client = _RecordingDB()
        self.module._request_events_table_available = True
        self.module._last_request_event_upload_at = self.module.time.time()
        self.module.fetch_usage_queue_items = lambda count: ([{
            "timestamp": "2026-04-15T10:30:00Z",
            "request_id": "deferred-req",
            "model": "gpt-4o",
        }], {"count": 1})
        try:
            result = self.module._usage_queue_sync_once()
            self.assertEqual(result["popped"], 1)
            self.assertEqual(result["persisted"], 0)
            self.assertTrue(result["upload_deferred"])
            self.assertEqual(len(events), 0)
            self.assertEqual(len(self.module._request_event_upload_buffer), 1)
            self.assertTrue(self.module.REQUEST_EVENTS_SPOOL_PATH.exists())
        finally:
            self.module.fetch_usage_queue_items = original_fetch
            self.module._request_events_table_available = original_available

    def test_request_event_spool_survives_restart_until_scheduled_flush(self):
        events = []

        class _RecordingTable(_DummyTable):
            def upsert(self, data, on_conflict=None):
                events.extend(data if isinstance(data, list) else [data])
                return self

        class _RecordingDB:
            def table(self, *a, **kw):
                return _RecordingTable()

        original_fetch = self.module.fetch_usage_queue_items
        original_available = self.module._request_events_table_available
        self.module.db_client = _RecordingDB()
        self.module._request_events_table_available = True
        self.module._last_request_event_upload_at = self.module.time.time()
        self.module.fetch_usage_queue_items = lambda count: ([{
            "timestamp": "2026-04-15T10:30:00Z",
            "request_id": "spooled-req",
            "model": "gpt-4o",
        }], {"count": 1})
        try:
            result = self.module._usage_queue_sync_once()
            self.assertEqual(result["persisted"], 0)
            self.assertEqual(len(events), 0)
            self.assertTrue(self.module.REQUEST_EVENTS_SPOOL_PATH.exists())

            # Simulate collector restart: memory buffer is gone but durable spool remains.
            self.module._request_event_upload_buffer = []
            self.module._last_request_event_upload_at = self.module.time.time() - self.module.MODEL_USAGE_UPLOAD_INTERVAL_SECONDS - 1
            flush = self.module._flush_request_event_upload_buffer("scheduled")

            self.assertTrue(flush["flushed"])
            self.assertEqual(flush["persisted"], 1)
            self.assertEqual(flush["aggregated_events"], 1)
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["api_endpoint"], "__request_events_aggregate__")
            self.assertEqual(events[0]["raw_detail"]["request_count"], 1)
            self.assertEqual(len(events[0]["raw_detail"]["event_uids"]), 1)
            spool_contents = self.module.REQUEST_EVENTS_SPOOL_PATH.read_text(encoding="utf-8")
            self.assertEqual(spool_contents, "")
        finally:
            self.module.fetch_usage_queue_items = original_fetch
            self.module._request_events_table_available = original_available

    def test_request_event_spool_retained_when_db_flush_fails(self):
        class _FailingTable(_DummyTable):
            def upsert(self, *a, **kw):
                raise RuntimeError("db unavailable")

        class _FailingDB:
            def table(self, *a, **kw):
                return _FailingTable()

        self.module.db_client = _FailingDB()
        self.module._request_events_table_available = True
        self.module._buffer_request_events_for_upload([self.module._transform_queue_event({
            "timestamp": "2026-04-15T10:30:00Z",
            "request_id": "db-fail-req",
            "model": "gpt-4o",
        })])

        result = self.module._flush_request_event_upload_buffer("scheduled", force=True)

        self.assertFalse(result["flushed"])
        self.assertEqual(result["skipped"], 1)
        self.assertIn("db-fail-req", self.module.REQUEST_EVENTS_SPOOL_PATH.read_text(encoding="utf-8"))

    def test_flush_preserves_events_appended_during_upload(self):
        original_upsert = self.module._upsert_request_events_batch
        uploaded = []

        first_event = self.module._transform_queue_event({
            "timestamp": "2026-04-15T10:30:00Z",
            "request_id": "first-req",
            "model": "gpt-4o",
        })
        second_event = self.module._transform_queue_event({
            "timestamp": "2026-04-15T10:31:00Z",
            "request_id": "second-req",
            "model": "gpt-4o",
        })

        def fake_upsert(events):
            uploaded.extend(events)
            self.module._buffer_request_events_for_upload([second_event])
            return len(events)

        class _RecordingDB:
            def table(self, *a, **kw):
                return _DummyTable()

        self.module.db_client = _RecordingDB()
        self.module._request_events_table_available = True
        self.module._upsert_request_events_batch = fake_upsert
        self.module._buffer_request_events_for_upload([first_event])
        try:
            result = self.module._flush_request_event_upload_buffer("scheduled", force=True)

            self.assertTrue(result["flushed"])
            self.assertEqual(len(uploaded), 1)
            self.assertEqual(uploaded[0]["api_endpoint"], "__request_events_aggregate__")
            self.assertEqual(uploaded[0]["raw_detail"]["event_uids"], [first_event["event_uid"]])
            spool_contents = self.module.REQUEST_EVENTS_SPOOL_PATH.read_text(encoding="utf-8")
            self.assertIn("second-req", spool_contents)
            self.assertNotIn("first-req", spool_contents)
        finally:
            self.module._upsert_request_events_batch = original_upsert

    def test_buffer_spool_append_uses_upload_lock(self):
        original_append = self.module._append_request_events_to_spool
        observed = []

        def fake_append(events):
            acquired = self.module._request_event_upload_lock.acquire(blocking=False)
            if acquired:
                self.module._request_event_upload_lock.release()
            observed.append(acquired)
            original_append(events)

        event = self.module._transform_queue_event({
            "timestamp": "2026-04-15T10:30:00Z",
            "request_id": "lock-req",
            "model": "gpt-4o",
        })
        self.module._append_request_events_to_spool = fake_append
        try:
            self.module._buffer_request_events_for_upload([event])
        finally:
            self.module._append_request_events_to_spool = original_append

        self.assertEqual(observed, [False])
        self.assertIn("lock-req", self.module.REQUEST_EVENTS_SPOOL_PATH.read_text(encoding="utf-8"))

    def test_flush_groups_request_event_aggregates_by_local_day(self):
        uploaded = []

        class _RecordingTable(_DummyTable):
            def upsert(self, data, on_conflict=None):
                uploaded.extend(data if isinstance(data, list) else [data])
                return self

        class _RecordingDB:
            def table(self, *a, **kw):
                return _RecordingTable()

        first_event = self.module._transform_queue_event({
            "timestamp": "2026-04-15T10:30:00Z",
            "request_id": "day-one",
            "model": "gpt-4o",
        })
        second_event = self.module._transform_queue_event({
            "timestamp": "2026-04-16T10:30:00Z",
            "request_id": "day-two",
            "model": "gpt-4o",
        })

        self.module.db_client = _RecordingDB()
        self.module._request_events_table_available = True
        self.module._buffer_request_events_for_upload([first_event, second_event])

        result = self.module._flush_request_event_upload_buffer("scheduled", force=True)

        self.assertTrue(result["flushed"])
        self.assertEqual(result["persisted"], 2)
        self.assertEqual(result["aggregated_events"], 2)
        self.assertEqual(len(uploaded), 2)
        self.assertEqual([row["raw_detail"]["request_count"] for row in uploaded], [1, 1])
        self.assertEqual([row["raw_detail"]["day"] for row in uploaded], ["2026-04-15", "2026-04-16"])

    def test_persist_queue_payloads_deduplicates_event_uid_within_batch(self):
        events = []

        class _RecordingTable(_DummyTable):
            def upsert(self, data, on_conflict=None):
                events.extend(data if isinstance(data, list) else [data])
                return self

        class _RecordingDB:
            def table(self, *a, **kw):
                return _RecordingTable()

        original_db = self.module.db_client
        original_available = self.module._request_events_table_available
        self.module.db_client = _RecordingDB()
        self.module._request_events_table_available = True
        self.module._last_request_event_upload_at = self.module.time.time() - self.module.MODEL_USAGE_UPLOAD_INTERVAL_SECONDS - 1
        duplicate_payloads = [
            {"timestamp": "2026-04-15T10:30:00Z", "request_id": "same-req", "model": "gpt-4o"},
            {"timestamp": "2026-04-15T10:30:00Z", "request_id": "same-req", "model": "gpt-4o"},
        ]
        try:
            result = self.module._persist_queue_payloads(duplicate_payloads)
            self.assertEqual(result["popped"], 2)
            self.assertEqual(result["parsed"], 2)
            self.assertEqual(result["persisted"], 1)
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["api_endpoint"], "__request_events_aggregate__")
            self.assertEqual(events[0]["raw_detail"]["request_count"], 1)
        finally:
            self.module.db_client = original_db
            self.module._request_events_table_available = original_available

    def test_persist_queue_payloads_logs_aggregated_usage_summary(self):
        class _RecordingTable(_DummyTable):
            def upsert(self, *a, **kw):
                return self

        class _RecordingDB:
            def table(self, *a, **kw):
                return _RecordingTable()

        original_db = self.module.db_client
        original_available = self.module._request_events_table_available
        self.module.db_client = _RecordingDB()
        self.module._request_events_table_available = True
        self.module._last_request_event_upload_at = self.module.time.time() - self.module.MODEL_USAGE_UPLOAD_INTERVAL_SECONDS - 1
        payloads = [
            {
                "timestamp": "2026-04-15T10:30:00Z",
                "request_id": "req-summary-1",
                "model": "gpt-4o",
                "tokens": {"input_tokens": 100, "output_tokens": 40, "total_tokens": 140},
                "failed": False,
            },
            {
                "timestamp": "2026-04-15T10:31:00Z",
                "request_id": "req-summary-2",
                "model": "gpt-4o",
                "tokens": {"input_tokens": 50, "output_tokens": 10, "total_tokens": 60},
                "failed": True,
            },
        ]
        try:
            with mock.patch.object(self.module.logger, "info") as info_mock:
                result = self.module._persist_queue_payloads(payloads)

            self.assertEqual(result["persisted"], 1)
            message = "Aggregated request event usage (%s): requests=%d, success=%d, failure=%d, total_tokens=%d, estimated_cost_usd=%.6f, top_models=[%s]"
            matching_calls = [call.args[1:] for call in info_mock.call_args_list if call.args and call.args[0] == message]
            self.assertTrue(matching_calls)
            args = matching_calls[0]
            self.assertEqual(args[0], "usage_queue_collected")
            self.assertEqual(args[1:5], (2, 1, 1, 200))
            self.assertIn("gpt-4o:requests=2,failures=1,tokens=200", args[6])
        finally:
            self.module.db_client = original_db
            self.module._request_events_table_available = original_available

    def test_run_full_sync_includes_usage_queue_sync(self):
        called = {"usage_queue": False, "management": False, "redis": False}
        original_usage_queue = self.module._usage_queue_sync_once
        original_management = self.module._run_management_sync
        original_redis = self.module._redis_queue_sync_once
        original_mode = self.module.USAGE_SYNC_MODE
        original_redis_addr = self.module.REDIS_QUEUE_ADDR
        self.module.USAGE_SYNC_MODE = "queue"
        self.module.REDIS_QUEUE_ADDR = ""
        self.module.db_client = _DummyDB()

        def fake_usage_queue():
            called["usage_queue"] = True
            return {"popped": 0, "parsed": 0, "persisted": 0, "duration_ms": 0, "meta": {}}

        def fake_management(run_id):
            called["management"] = True

        def fake_redis():
            called["redis"] = True
            return {"popped": 0, "parsed": 0, "persisted": 0, "duration_ms": 0}

        self.module._usage_queue_sync_once = fake_usage_queue
        self.module._run_management_sync = fake_management
        self.module._redis_queue_sync_once = fake_redis
        try:
            self.module.run_full_sync_once()
            self.assertTrue(called["usage_queue"], "_usage_queue_sync_once must be called in run_full_sync_once")
            self.assertFalse(called["management"])
            self.assertFalse(called["redis"])
        finally:
            self.module._usage_queue_sync_once = original_usage_queue
            self.module._run_management_sync = original_management
            self.module._redis_queue_sync_once = original_redis
            self.module.USAGE_SYNC_MODE = original_mode
            self.module.REDIS_QUEUE_ADDR = original_redis_addr

    def test_run_full_sync_does_not_app_log_request_event_persistence(self):
        logged_titles = []
        original_usage_queue = self.module._usage_queue_sync_once
        original_redis = self.module._redis_queue_sync_once
        original_log_sync = self.module._log_sync_event
        original_mode = self.module.USAGE_SYNC_MODE
        original_redis_addr = self.module.REDIS_QUEUE_ADDR
        self.module.USAGE_SYNC_MODE = "auto"
        self.module.REDIS_QUEUE_ADDR = "redis://localhost:6379"
        self.module.db_client = _DummyDB()

        self.module._usage_queue_sync_once = lambda: {
            "popped": 1,
            "parsed": 1,
            "persisted": 1,
            "duration_ms": 0,
            "meta": {},
        }
        self.module._redis_queue_sync_once = lambda: {
            "popped": 1,
            "parsed": 1,
            "persisted": 1,
            "duration_ms": 0,
        }
        self.module._log_sync_event = lambda **kw: logged_titles.append(kw.get("title"))

        try:
            self.module.run_full_sync_once()
            self.assertNotIn("Usage queue sync ok", logged_titles)
            self.assertNotIn("Redis queue sync ok", logged_titles)
        finally:
            self.module._usage_queue_sync_once = original_usage_queue
            self.module._redis_queue_sync_once = original_redis
            self.module._log_sync_event = original_log_sync
            self.module.USAGE_SYNC_MODE = original_mode
            self.module.REDIS_QUEUE_ADDR = original_redis_addr

    def test_redis_queue_sync_pops_and_persists(self):
        events = []

        class _RecordingTable(_DummyTable):
            def upsert(self, data, on_conflict=None):
                events.extend(data if isinstance(data, list) else [data])
                return self

        class _RecordingDB:
            def table(self, *a, **kw):
                return _RecordingTable()

        payload = json.dumps({
            "timestamp": "2026-04-15T10:30:00Z",
            "latency_ms": 100,
            "model": "claude-sonnet-4",
            "endpoint": "/v1/messages",
            "request_id": "req-test-1",
            "tokens": {"input_tokens": 50, "output_tokens": 25, "total_tokens": 75},
            "provider": "anthropic",
            "api_key": "sk-long-secret-key-12345",
        }).encode()

        class _FakeRESPClient:
            def __init__(self, addr, socket_timeout=5.0):
                pass
            def lpop_batch(self, key, count):
                return [payload]
            def close(self):
                pass

        self.module.REDIS_QUEUE_ADDR = "redis://localhost:6379"
        self.module.db_client = _RecordingDB()
        original_client = self.module.RESPClient
        original_available = self.module._request_events_table_available
        self.module.RESPClient = _FakeRESPClient
        self.module._request_events_table_available = True

        try:
            result = self.module._redis_queue_sync_once()
            self.assertEqual(result["popped"], 1)
            self.assertEqual(result["parsed"], 1)
            self.assertEqual(result["persisted"], 0)
            self.assertTrue(result["upload_deferred"])
            self.assertEqual(len(events), 0)

            flush = self.module._flush_request_event_upload_buffer("scheduled", force=True)
            self.assertEqual(flush["persisted"], 1)
            self.assertEqual(len(events), 1)
            self.assertNotIn("sk-long-secret-key-12345", json.dumps(events[0]["raw_detail"]))
        finally:
            self.module.RESPClient = original_client
            self.module._request_events_table_available = original_available


class RESPClientProtocolTests(unittest.TestCase):
    """Tests for the RESP wire protocol client itself."""

    @classmethod
    def setUpClass(cls):
        import importlib
        spec = importlib.util.spec_from_file_location(
            "redis_queue_client_real",
            ROOT / "redis_queue_client.py",
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        cls.RESPClient = mod.RESPClient
        cls.RESPError = mod.RESPError

    def _make_client(self):
        return self.RESPClient.__new__(self.RESPClient)

    def test_parse_simple_string(self):
        client = self._make_client()
        client._readline = lambda: b"+PONG"
        result = client._read_response()
        self.assertEqual(result, b"PONG")

    def test_parse_integer(self):
        client = self._make_client()
        client._readline = lambda: b":42"
        result = client._read_response()
        self.assertEqual(result, 42)

    def test_parse_bulk_string(self):
        client = self._make_client()
        client._readline = lambda: b"$5"
        client._recv = lambda n: b"hello" if n == 5 else b"\r\n"
        result = client._read_response()
        self.assertEqual(result, b"hello")

    def test_parse_null_bulk_string(self):
        client = self._make_client()
        client._readline = lambda: b"$-1"
        result = client._read_response()
        self.assertIsNone(result)

    def test_parse_error_raises(self):
        client = self._make_client()
        client._readline = lambda: b"-ERR unknown command"
        with self.assertRaises(self.RESPError):
            client._read_response()

    def test_parse_array(self):
        client = self._make_client()
        call_count = 0

        def fake_readline():
            nonlocal call_count
            data = [b"*2", b"$-1", b":99"][call_count]
            call_count += 1
            return data

        client._readline = fake_readline
        client._recv = lambda n: b"\r\n"
        result = client._read_response()
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 2)
        self.assertIsNone(result[0])
        self.assertEqual(result[1], 99)


if __name__ == "__main__":
    unittest.main()
