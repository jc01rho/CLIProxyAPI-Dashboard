import unittest
import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from credential_stats_sync import CredentialStatsSync


class _Response:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


class CredentialStatsSyncTests(unittest.TestCase):
    def test_fetch_usage_404_marks_legacy_unavailable_without_error_log(self):
        syncer = CredentialStatsSync("http://cliproxy", "mgmt-key", supabase_client=object())

        with mock.patch("credential_stats_sync.requests.get", return_value=_Response(404)) as get_mock, \
             mock.patch("credential_stats_sync.logger.error") as error_log, \
             mock.patch("credential_stats_sync.logger.info") as info_log:
            result = syncer.fetch_usage()

        self.assertIsNone(result)
        self.assertTrue(syncer.legacy_usage_unavailable)
        self.assertFalse(error_log.called)
        self.assertTrue(info_log.called)
        get_mock.assert_called_once_with(
            "http://cliproxy/v0/management/usage",
            headers={"Authorization": "Bearer mgmt-key"},
            timeout=30,
        )

    def test_sync_404_returns_skipped_not_error(self):
        syncer = CredentialStatsSync("http://cliproxy", "mgmt-key", supabase_client=object())

        with mock.patch.object(syncer, "fetch_usage", return_value=None):
            syncer.legacy_usage_unavailable = True
            stats = syncer.sync()

        self.assertTrue(stats["skipped"])
        self.assertFalse(stats["error"])
        self.assertEqual(stats["credentials"], 0)
        self.assertEqual(stats["api_keys"], 0)


if __name__ == "__main__":
    unittest.main()
