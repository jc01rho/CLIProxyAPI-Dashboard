"""Tests for Redis queue event ingestion: payload parsing, transformation, redaction, dedup."""

import hashlib
import importlib.util
import json
import sys
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
    flask.jsonify = lambda *a, **kw: {}
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
        self.assertTrue(uid1.startswith("rq:"))

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
        self.assertTrue(self.module._should_use_management_polling())
        self.assertTrue(self.module._should_use_usage_queue())

        self.module.USAGE_SYNC_MODE = "auto"
        self.module.REDIS_QUEUE_ADDR = ""
        self.assertFalse(self.module._should_use_redis_queue())
        self.assertTrue(self.module._should_use_management_polling())

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
        self.module.db_client = _RecordingDB()
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
            self.assertEqual(result["persisted"], 1)
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["request_id"], "req-http-sync")
        finally:
            self.module.fetch_usage_queue_items = original_fetch

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
        self.module.RESPClient = _FakeRESPClient

        try:
            result = self.module._redis_queue_sync_once()
            self.assertEqual(result["popped"], 1)
            self.assertEqual(result["parsed"], 1)
            self.assertEqual(result["persisted"], 1)
            self.assertEqual(len(events), 1)
            self.assertNotIn("sk-long-secret-key-12345", json.dumps(events[0]["raw_detail"]))
        finally:
            self.module.RESPClient = original_client


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
