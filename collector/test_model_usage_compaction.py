import importlib.util
import sys
import time
import types
import unittest
from pathlib import Path
from unittest import mock

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
    flask.jsonify = lambda x=None, *args, **kwargs: x if x is not None else kwargs
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
    spec = importlib.util.spec_from_file_location("collector_main_compaction", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FloorTo30MinBucketTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = _load_module()

    def _floor(self, iso: str) -> str:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        result = self.m._floor_to_30min_bucket(dt)
        return result.isoformat()

    def test_exact_hour_stays_unchanged(self):
        self.assertEqual(self._floor("2026-04-25T12:00:00+00:00"), "2026-04-25T12:00:00+00:00")

    def test_exact_half_hour_stays_unchanged(self):
        self.assertEqual(self._floor("2026-04-25T12:30:00+00:00"), "2026-04-25T12:30:00+00:00")

    def test_minute_21_maps_to_hour(self):
        result = self._floor("2026-04-25T12:21:56.858477+00:00")
        self.assertEqual(result, "2026-04-25T12:00:00+00:00")

    def test_minute_35_maps_to_half_hour(self):
        result = self._floor("2026-04-25T12:35:00+00:00")
        self.assertEqual(result, "2026-04-25T12:30:00+00:00")

    def test_minute_29_maps_to_hour(self):
        result = self._floor("2026-04-25T12:29:59+00:00")
        self.assertEqual(result, "2026-04-25T12:00:00+00:00")

    def test_minute_59_maps_to_half_hour(self):
        result = self._floor("2026-04-25T12:59:00+00:00")
        self.assertEqual(result, "2026-04-25T12:30:00+00:00")

    def test_non_utc_input_normalised_to_utc(self):
        result = self._floor("2026-04-25T19:21:00+07:00")
        self.assertEqual(result, "2026-04-25T12:00:00+00:00")


class PlanModelUsageSnapshotCompactionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = _load_module()

    def test_keeps_last_per_30min_bucket(self):
        plan = self.m._plan_model_usage_snapshot_compaction(
            [
                {"id": 1, "collected_at": "2026-04-25T12:05:00+00:00"},
                {"id": 2, "collected_at": "2026-04-25T12:15:00+00:00"},
                {"id": 3, "collected_at": "2026-04-25T12:25:00+00:00"},
                {"id": 4, "collected_at": "2026-04-25T12:35:00+00:00"},
                {"id": 5, "collected_at": "2026-04-25T12:55:00+00:00"},
            ],
            min_age_minutes=0,
        )
        self.assertEqual(plan["delete_snapshot_ids"], [1, 2, 4])
        self.assertIn(3, plan["keep_snapshot_ids"])
        self.assertIn(5, plan["keep_snapshot_ids"])
        self.assertEqual(plan["retained_buckets"], 2)

    def test_protects_snapshots_newer_than_min_age(self):
        original_utcnow = self.m._utcnow
        self.m._utcnow = lambda: self.m.datetime.fromisoformat("2026-04-25T13:00:00+00:00")
        try:
            plan = self.m._plan_model_usage_snapshot_compaction(
                [
                    {"id": 10, "collected_at": "2026-04-25T12:00:00+00:00"},
                    {"id": 11, "collected_at": "2026-04-25T12:10:00+00:00"},
                    {"id": 12, "collected_at": "2026-04-25T12:35:00+00:00"},
                    {"id": 13, "collected_at": "2026-04-25T12:45:00+00:00"},
                ],
                min_age_minutes=30,
            )
        finally:
            self.m._utcnow = original_utcnow

        self.assertIn(12, plan["keep_snapshot_ids"])
        self.assertIn(13, plan["keep_snapshot_ids"])
        self.assertIn(10, plan["delete_snapshot_ids"])

    def test_preserves_invalid_timestamp_rows(self):
        plan = self.m._plan_model_usage_snapshot_compaction(
            [
                {"id": 100, "collected_at": "invalid-ts"},
                {"id": 101, "collected_at": "2026-04-25T12:00:00+00:00"},
                {"id": 102, "collected_at": "2026-04-25T12:20:00+00:00"},
            ],
            min_age_minutes=0,
        )
        self.assertIn(100, plan["keep_snapshot_ids"])
        self.assertIn(100, plan["skipped_snapshot_ids"])
        self.assertNotIn(100, plan["delete_snapshot_ids"])
        self.assertEqual(plan["delete_snapshot_ids"], [101])

    def test_boundary_timestamp_12_21_56(self):
        plan = self.m._plan_model_usage_snapshot_compaction(
            [
                {"id": 1, "collected_at": "2026-04-25T12:00:00+00:00"},
                {"id": 2, "collected_at": "2026-04-25T12:21:56.858477+00:00"},
                {"id": 3, "collected_at": "2026-04-25T12:30:00+00:00"},
                {"id": 4, "collected_at": "2026-04-25T12:58:00+00:00"},
            ],
            min_age_minutes=0,
        )
        self.assertIn(2, plan["keep_snapshot_ids"])
        self.assertIn(1, plan["delete_snapshot_ids"])
        self.assertIn(4, plan["keep_snapshot_ids"])
        self.assertIn(3, plan["delete_snapshot_ids"])
        self.assertEqual(plan["retained_buckets"], 2)

    def test_single_snapshot_per_bucket_kept_unchanged(self):
        plan = self.m._plan_model_usage_snapshot_compaction(
            [{"id": 1, "collected_at": "2026-04-25T12:10:00+00:00"}],
            min_age_minutes=0,
        )
        self.assertEqual(plan["delete_snapshot_ids"], [])
        self.assertEqual(plan["keep_snapshot_ids"], [1])
        self.assertEqual(plan["retained_buckets"], 1)

    def test_empty_input(self):
        plan = self.m._plan_model_usage_snapshot_compaction([], min_age_minutes=0)
        self.assertEqual(plan["delete_snapshot_ids"], [])
        self.assertEqual(plan["keep_snapshot_ids"], [])
        self.assertEqual(plan["retained_buckets"], 0)


class CompactModelUsageDbTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = _load_module()

    def test_returns_zeros_when_no_db_client(self):
        self.m.db_client = None
        result = self.m._compact_model_usage_db()
        self.assertEqual(result["snapshots_deleted"], 0)
        self.assertFalse(result["error"])

    def test_returns_zeros_when_no_snapshots_in_window(self):
        class EmptyTable(_DummyTable):
            def execute(self):
                return _DummyResponse([])

        class EmptyDB:
            def table(self, *args, **kwargs):
                return EmptyTable()

        self.m.db_client = EmptyDB()
        result = self.m._compact_model_usage_db()
        self.assertEqual(result["snapshots_deleted"], 0)
        self.assertFalse(result["error"])

    def test_batches_deletes_for_large_id_list(self):
        delete_calls = []

        class RecordingTable(_DummyTable):
            def __init__(self):
                self._is_delete = False
                self._in_ids = []

            def delete(self, *args, **kwargs):
                self._is_delete = True
                return self

            def in_(self, column, ids):
                if self._is_delete:
                    delete_calls.append(len(ids))
                return self

            def execute(self):
                if self._is_delete:
                    return _DummyResponse([{"id": i} for i in range(10)])
                snapshots = [
                    {"id": i, "collected_at": f"2026-04-25T10:{i:02d}:00+00:00"}
                    for i in range(60)
                ]
                return _DummyResponse(snapshots)

        class RecordingDB:
            def table(self, *args, **kwargs):
                return RecordingTable()

        self.m.db_client = RecordingDB()
        self.m._utcnow = lambda: self.m.datetime.fromisoformat("2026-04-25T14:00:00+00:00")
        self.m.MODEL_USAGE_COMPACTION_MIN_AGE_MINUTES = 0

        original_plan = self.m._plan_model_usage_snapshot_compaction

        def mock_plan(snapshots, min_age_minutes=0):
            return {
                "delete_snapshot_ids": list(range(1, 601)),
                "keep_snapshot_ids": [],
                "retained_buckets": 0,
                "skipped_snapshot_ids": [],
            }

        self.m._plan_model_usage_snapshot_compaction = mock_plan
        try:
            self.m._compact_model_usage_db()
            self.assertGreater(len(delete_calls), 1)
            for batch_size in delete_calls:
                self.assertLessEqual(batch_size, 500)
        finally:
            self.m._plan_model_usage_snapshot_compaction = original_plan
            self.m.MODEL_USAGE_COMPACTION_MIN_AGE_MINUTES = 30

    def test_html_gateway_error_on_query_logs_warning_not_error(self):
        html_gateway_exc = Exception(
            "{'code': 502, 'details': '<!DOCTYPE html><html>Cloudflare Bad Gateway</html>'}"
        )

        class FailTable(_DummyTable):
            def execute(self):
                raise html_gateway_exc

        class FailDB:
            def table(self, *args, **kwargs):
                return FailTable()

        self.m.db_client = FailDB()
        with mock.patch.object(self.m.logger, "warning") as warn, \
             mock.patch.object(self.m.logger, "error") as err:
            result = self.m._compact_model_usage_db()
        self.assertTrue(result["error"])
        warn.assert_called_once()
        err.assert_not_called()


class ManagementUploadRateLimitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = _load_module()
        cls._original_log_sync_event = cls.m._log_sync_event
        cls._original_log_app_event = cls.m._log_app_event

    def setUp(self):
        self.m._last_management_upload_at = 0
        self.m._management_deferred_sync_count = 0
        self.m.LOG_VERBOSITY = "normal"
        self.m._log_sync_event = type(self)._original_log_sync_event
        self.m._log_app_event = type(self)._original_log_app_event
        import threading
        self.m._management_upload_lock = threading.Lock()

    def test_first_call_proceeds(self):
        fetch_calls = []
        store_calls = []

        self.m.fetch_usage_data = lambda: ({"usage": {}}, {})
        self.m.store_usage_data = lambda data, run_id=None: (store_calls.append(data), (True, {}))[-1]
        self.m._compact_model_usage_db = lambda: {"snapshots_deleted": 0, "retained_buckets": 0, "error": False}
        self.m._log_sync_event = lambda **kw: None
        self.m.CLIPROXY_URL = "http://localhost"

        self.m._run_management_sync("run-001")
        self.assertEqual(len(store_calls), 1)

    def test_second_call_within_interval_is_skipped(self):
        fetch_calls = []
        store_calls = []

        self.m.fetch_usage_data = lambda: (fetch_calls.append(1), ({"usage": {}}, {}))[1]
        self.m.store_usage_data = lambda data, run_id=None: (store_calls.append(data), (True, {}))[-1]
        self.m._compact_model_usage_db = lambda: {"snapshots_deleted": 0, "retained_buckets": 0, "error": False}
        self.m._log_sync_event = lambda **kw: None
        self.m.CLIPROXY_URL = "http://localhost"

        self.m._last_management_upload_at = time.time()

        self.m._run_management_sync("run-002")
        self.assertEqual(len(fetch_calls), 1)
        self.assertEqual(len(store_calls), 0)

    def test_call_after_interval_elapsed_proceeds(self):
        store_calls = []

        self.m.fetch_usage_data = lambda: ({"usage": {}}, {})
        self.m.store_usage_data = lambda data, run_id=None: (store_calls.append(data), (True, {}))[-1]
        self.m._compact_model_usage_db = lambda: {"snapshots_deleted": 0, "retained_buckets": 0, "error": False}
        self.m._log_sync_event = lambda **kw: None
        self.m.CLIPROXY_URL = "http://localhost"

        self.m._last_management_upload_at = time.time() - self.m.MODEL_USAGE_UPLOAD_INTERVAL_SECONDS - 1

        self.m._run_management_sync("run-003")
        self.assertEqual(len(store_calls), 1)

    def test_failed_store_resets_upload_timer(self):
        self.m.fetch_usage_data = lambda: ({"usage": {}}, {})
        self.m.store_usage_data = lambda data, run_id=None: (False, {"error": "fail"})
        self.m._log_sync_event = lambda **kw: None
        self.m.CLIPROXY_URL = "http://localhost"

        self.m._run_management_sync("run-004")
        self.assertEqual(self.m._last_management_upload_at, 0)

    def test_failed_fetch_resets_upload_timer(self):
        self.m.fetch_usage_data = lambda: (None, {})
        self.m._log_sync_event = lambda **kw: None
        self.m.CLIPROXY_URL = "http://localhost"

        self.m._run_management_sync("run-005")
        self.assertEqual(self.m._last_management_upload_at, 0)

    def test_compaction_called_after_successful_upload(self):
        compact_calls = []

        self.m.fetch_usage_data = lambda: ({"usage": {}}, {})
        self.m.store_usage_data = lambda data, run_id=None: (True, {})
        self.m._compact_model_usage_db = lambda: compact_calls.append(1) or {"snapshots_deleted": 5, "retained_buckets": 2, "error": False}
        self.m._log_sync_event = lambda **kw: None
        self.m.CLIPROXY_URL = "http://localhost"

        self.m._run_management_sync("run-006")
        self.assertEqual(len(compact_calls), 1)

    def test_compaction_not_called_when_upload_skipped(self):
        compact_calls = []

        self.m.fetch_usage_data = lambda: ({"usage": {}}, {})
        self.m.store_usage_data = lambda data, run_id=None: (True, {})
        self.m._compact_model_usage_db = lambda: compact_calls.append(1) or {}
        self.m._log_sync_event = lambda **kw: None
        self.m._last_management_upload_at = time.time()

        self.m._run_management_sync("run-007")
        self.assertEqual(len(compact_calls), 0)

    def test_accumulation_snapshot_logs_current_usage_to_buffer(self):
        logged = []

        self.m.fetch_usage_data = lambda: ({
            "usage": {
                "total_requests": 12,
                "success_count": 10,
                "failure_count": 2,
                "total_tokens": 345,
            }
        }, {})
        self.m._log_app_event = lambda **kw: logged.append(kw)
        self.m._last_management_upload_at = time.time()

        self.m._run_management_sync("run-008")

        snapshots = [item for item in logged if item.get("title") == "Usage accumulation snapshot"]
        self.assertEqual(len(snapshots), 1)
        details = snapshots[0]["details"]
        self.assertEqual(details["accumulated_syncs_since_last_upload"], 1)
        self.assertEqual(details["total_requests"], 12)
        self.assertEqual(details["success_count"], 10)
        self.assertEqual(details["failure_count"], 2)
        self.assertEqual(details["total_tokens"], 345)

    def test_accumulation_snapshot_logs_current_usage_to_stdout(self):
        self.m.fetch_usage_data = lambda: ({
            "usage": {
                "total_requests": 12,
                "success_count": 10,
                "failure_count": 2,
                "total_tokens": 345,
            }
        }, {})
        self.m._log_sync_event = lambda **kw: None
        self.m._last_management_upload_at = time.time()

        with mock.patch.object(self.m.logger, "info") as info_mock:
            self.m._run_management_sync("run-008-stdout")

        calls_by_message = {call.args[0]: call.args[1:] for call in info_mock.call_args_list if call.args}
        message = "Aggregated usage accumulation: syncs=%d, next_upload_in=%ds, interval=%ds, total_requests=%s, success=%s, failure=%s, total_tokens=%s"
        self.assertIn(message, calls_by_message)
        args = calls_by_message[message]
        self.assertEqual(args[0], 1)
        self.assertGreaterEqual(args[1], self.m.MODEL_USAGE_UPLOAD_INTERVAL_SECONDS - 1)
        self.assertEqual(args[2:], (self.m.MODEL_USAGE_UPLOAD_INTERVAL_SECONDS, 12, 10, 2, 345))

    def test_successful_upload_logs_aggregated_summary_to_stdout(self):
        self.m.fetch_usage_data = lambda: ({"usage": {}}, {})
        self.m.store_usage_data = lambda data, run_id=None: (True, {
            "incremental_requests": 7,
            "incremental_tokens": 900,
            "incremental_cost_usd": 0.0123,
            "daily_total_requests": 17,
            "daily_total_tokens": 1900,
            "daily_total_cost_usd": 0.0456,
            "model_rows_inserted": 2,
            "duration_ms": 33,
        })
        self.m._compact_model_usage_db = lambda: {"snapshots_deleted": 0, "retained_buckets": 0, "error": False}
        self.m._log_sync_event = lambda **kw: None
        self.m._management_deferred_sync_count = 2

        with mock.patch.object(self.m.logger, "info") as info_mock:
            self.m._run_management_sync("run-009-stdout")

        calls_by_message = {call.args[0]: call.args[1:] for call in info_mock.call_args_list if call.args}
        message = "Aggregated usage upload ok: deferred_syncs=%d, interval=%ds, incremental_requests=%s, incremental_tokens=%s, incremental_cost_usd=%s, daily_total_requests=%s, daily_total_tokens=%s, daily_total_cost_usd=%s, model_rows_inserted=%s, duration_ms=%s"
        self.assertIn(message, calls_by_message)
        self.assertEqual(
            calls_by_message[message],
            (2, self.m.MODEL_USAGE_UPLOAD_INTERVAL_SECONDS, 7, 900, 0.0123, 17, 1900, 0.0456, 2, 33),
        )

class MainSchedulerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = _load_module()

    def test_main_schedules_model_usage_compaction_job(self):
        serve_calls = []
        fake_db = object()

        self.m.init_db = lambda: fake_db
        self.m.db_client = fake_db
        self.m.flask_app = self.m.Flask(__name__)
        self.m._run_startup_cleanup = lambda: {}
        self.m.run_full_sync_once = lambda: None
        self.m.sync_credential_stats = lambda *args, **kwargs: None
        self.m.serve = lambda *args, **kwargs: serve_calls.append(True)

        self.m.main()

        scheduler = _RecordedScheduler.instances[-1]
        compaction_jobs = [
            job for job in scheduler.jobs
            if job["kwargs"].get("id") == "model_usage_compaction"
        ]
        self.assertEqual(len(compaction_jobs), 1)
        job = compaction_jobs[0]
        self.assertEqual(job["trigger"], "interval")
        self.assertIn("minutes", job["kwargs"])
        self.assertEqual(job["kwargs"]["minutes"], self.m.MODEL_USAGE_COMPACTION_INTERVAL_MINUTES)

    def test_main_schedules_request_events_upload_flush_job(self):
        serve_calls = []
        fake_db = object()

        self.m.init_db = lambda: fake_db
        self.m.db_client = fake_db
        self.m.flask_app = self.m.Flask(__name__)
        self.m._run_startup_cleanup = lambda: {}
        self.m.run_full_sync_once = lambda: None
        self.m.sync_credential_stats = lambda *args, **kwargs: None
        self.m.serve = lambda *args, **kwargs: serve_calls.append(True)

        self.m.main()

        scheduler = _RecordedScheduler.instances[-1]
        flush_jobs = [
            job for job in scheduler.jobs
            if job["kwargs"].get("id") == "request_events_upload_flush"
        ]
        self.assertEqual(len(flush_jobs), 1)
        job = flush_jobs[0]
        self.assertEqual(job["trigger"], "interval")
        self.assertEqual(job["kwargs"]["seconds"], self.m.MODEL_USAGE_UPLOAD_INTERVAL_SECONDS)

    def test_model_usage_upload_interval_default(self):
        self.assertEqual(self.m.MODEL_USAGE_UPLOAD_INTERVAL_SECONDS, 1800)

    def test_queue_sync_interval_defaults_are_one_minute(self):
        self.assertEqual(self.m.USAGE_QUEUE_SYNC_INTERVAL, 60)
        self.assertEqual(self.m.REDIS_QUEUE_SYNC_INTERVAL, 60)

    def test_queue_sync_jobs_start_after_one_interval(self):
        serve_calls = []
        fake_db = object()

        self.m.init_db = lambda: fake_db
        self.m.db_client = fake_db
        self.m.flask_app = self.m.Flask(__name__)
        self.m._run_startup_cleanup = lambda: {}
        self.m.run_full_sync_once = lambda: None
        self.m.sync_credential_stats = lambda *args, **kwargs: None
        self.m.serve = lambda *args, **kwargs: serve_calls.append(True)
        original_mode = self.m.USAGE_SYNC_MODE
        original_redis_addr = self.m.REDIS_QUEUE_ADDR
        self.m.USAGE_SYNC_MODE = "auto"
        self.m.REDIS_QUEUE_ADDR = "redis://localhost:6379"

        try:
            self.m.main()
        finally:
            self.m.USAGE_SYNC_MODE = original_mode
            self.m.REDIS_QUEUE_ADDR = original_redis_addr

        scheduler = _RecordedScheduler.instances[-1]
        jobs_by_id = {job["kwargs"].get("id"): job for job in scheduler.jobs}

        usage_delay = jobs_by_id["usage_queue_sync"]["kwargs"]["next_run_time"] - self.m.datetime.now()
        redis_delay = jobs_by_id["redis_queue_sync"]["kwargs"]["next_run_time"] - self.m.datetime.now()
        self.assertGreaterEqual(usage_delay.total_seconds(), self.m.USAGE_QUEUE_SYNC_INTERVAL - 1)
        self.assertGreaterEqual(redis_delay.total_seconds(), self.m.REDIS_QUEUE_SYNC_INTERVAL - 1)

    def test_model_usage_compaction_interval_default(self):
        self.assertEqual(self.m.MODEL_USAGE_COMPACTION_INTERVAL_MINUTES, 60)

    def test_model_usage_compaction_min_age_default(self):
        self.assertEqual(self.m.MODEL_USAGE_COMPACTION_MIN_AGE_MINUTES, 30)

    def test_model_usage_compaction_lookback_default(self):
        self.assertEqual(self.m.MODEL_USAGE_COMPACTION_LOOKBACK_HOURS, 3)


if __name__ == "__main__":
    unittest.main()
