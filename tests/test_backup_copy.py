import datetime as dt
import gzip
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("backup_copy", Path(__file__).parents[1] / "deploy/devbox/copy-backup-offhost.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupCopyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.destination = Path(self.temp.name) / "backups"
        self.name = "candids-" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + ".tar.gz"
        self.archive = gzip.compress(b"synthetic stopped-state archive")
        self.sha = hashlib.sha256(self.archive).hexdigest()
        self.names = [self.name]
        self.calls = []

    def remote(self, command, output=None):
        self.calls.append(command)
        if command.startswith("sudo -n find "):
            return "\n".join(self.names)
        if command == f"sudo -n cat {backup.REMOTE}/{self.name}.sha256":
            return f"{self.sha}  {backup.REMOTE}/{self.name}\n"
        if command == f"sudo -n stat -c %s {backup.REMOTE}/{self.name}":
            return str(len(self.archive))
        if command == f"sudo -n cat {backup.REMOTE}/{self.name}" and output is not None:
            output.write(self.archive)
            return None
        raise AssertionError("Unexpected remote operation")

    def collect(self):
        with patch.object(backup, "DESTINATION", self.destination), patch.object(backup, "remote", self.remote):
            return backup.collect()

    def test_valid_copy_is_private_verified_and_idempotent(self):
        self.assertEqual(self.collect(), self.name)
        self.assertEqual((self.destination / self.name).read_bytes(), self.archive)
        self.assertEqual((self.destination / self.name).stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.destination.stat().st_mode & 0o777, 0o700)
        self.calls.clear()
        self.collect()
        self.assertNotIn(f"sudo -n cat {backup.REMOTE}/{self.name}", self.calls)

    def test_unsafe_remote_names_never_reach_an_interpolated_command(self):
        self.names = ["../../secrets.env"]
        with self.assertRaises(ValueError):
            self.collect()
        self.assertEqual(len(self.calls), 1)

    def test_checksum_failure_leaves_no_archive_or_partial(self):
        self.sha = "0" * 64
        with self.assertRaises(ValueError):
            self.collect()
        self.assertEqual([p.name for p in self.destination.iterdir()], [".copy.lock"])

    def test_stale_backup_rejected_before_copy(self):
        self.names = ["candids-20200101T000000Z.tar.gz"]
        with self.assertRaises(ValueError):
            self.collect()
        self.assertEqual(len(self.calls), 1)

    def test_retention_prunes_only_own_regular_dated_files(self):
        self.destination.mkdir()
        old = self.destination / "candids-20200101T000000Z.tar.gz"
        old.write_bytes(b"old")
        unrelated = self.destination / "operator-notes.txt"
        unrelated.write_text("keep")
        linked = self.destination / "candids-20200102T000000Z.tar.gz"
        linked.symlink_to(unrelated)
        self.collect()
        self.assertFalse(old.exists())
        self.assertEqual(unrelated.read_text(), "keep")
        self.assertTrue(linked.is_symlink())

    def test_existing_mismatch_is_not_overwritten(self):
        self.destination.mkdir()
        final = self.destination / self.name
        final.write_bytes(b"preserve evidence")
        with self.assertRaises(ValueError):
            self.collect()
        self.assertEqual(final.read_bytes(), b"preserve evidence")


if __name__ == "__main__":
    unittest.main()
