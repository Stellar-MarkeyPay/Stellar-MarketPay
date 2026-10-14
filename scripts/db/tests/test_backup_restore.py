import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))


def _write_fake_backup(path: Path) -> None:
    path.write_bytes(b"fake sql content")
    actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    checksum_path = Path(f"{path}.sha256")
    checksum_path.write_text(f"{actual_hash}  {path.name}\n")


def _mock_subprocess_run(*args, **kwargs):
    cmd = str(kwargs.get("args", args))
    if ">" in cmd:
        output_path = cmd.split(">")[-1].strip().strip("'\",)")
        Path(output_path).write_bytes(b"fake backup content")
    return MagicMock(returncode=0)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_argv = sys.argv[:]
        self.original_env = os.environ.copy()

    def tearDown(self):
        sys.argv = self.original_argv
        os.environ.clear()
        os.environ.update(self.original_env)
        self.temp_dir.cleanup()

    def test_fails_when_database_url_is_missing(self):
        from backup import main, parse_args

        sys.argv = ["backup.py"]
        args = parse_args()
        args.database_url = ""
        self.assertEqual(main(args), 1)

    @patch("subprocess.run", side_effect=_mock_subprocess_run)
    def test_creates_backup_files(self, mock_run):
        from backup import main, parse_args

        with tempfile.TemporaryDirectory() as td:
            sys.argv = ["backup.py"]
            args = parse_args()
            args.database_url = "postgresql://user:pass@localhost:5432/db"
            args.backup_dir = td
            args.off_site_copy = ""
            self.assertEqual(main(args), 0)
            daily_dir = Path(td) / "daily"
            self.assertTrue(any(daily_dir.glob("*.sql.gz")))

    @patch("subprocess.run", side_effect=_mock_subprocess_run)
    def test_creates_checksum_files(self, mock_run):
        from backup import main, parse_args

        with tempfile.TemporaryDirectory() as td:
            sys.argv = ["backup.py"]
            args = parse_args()
            args.database_url = "postgresql://user:pass@localhost:5432/db"
            args.backup_dir = td
            args.off_site_copy = ""
            self.assertEqual(main(args), 0)
            daily_dir = Path(td) / "daily"
            self.assertTrue(any(daily_dir.glob("*.sha256")))

    @patch("subprocess.run", side_effect=_mock_subprocess_run)
    def test_promotes_weekly_on_sunday(self, mock_run):
        from backup import main, parse_args

        with tempfile.TemporaryDirectory() as td:
            sys.argv = ["backup.py"]
            args = parse_args()
            args.database_url = "postgresql://user:pass@localhost:5432/db"
            args.backup_dir = td
            args.off_site_copy = ""
            with patch("backup.datetime") as mock_dt:
                mock_dt.utcnow.return_value.strftime.side_effect = lambda fmt: (
                    "20260823T000000Z"
                    if fmt == "%Y%m%dT%H%M%SZ"
                    else "2026-08-23"
                    if fmt == "%Y-%m-%d"
                    else "7"
                    if fmt == "%u"
                    else ""
                )
                self.assertEqual(main(args), 0)
            weekly_dir = Path(td) / "weekly"
            self.assertTrue(any(weekly_dir.glob("*.sql.gz")))

    @patch("subprocess.run", side_effect=_mock_subprocess_run)
    def test_promotes_monthly_on_first(self, mock_run):
        from backup import main, parse_args

        with tempfile.TemporaryDirectory() as td:
            sys.argv = ["backup.py"]
            args = parse_args()
            args.database_url = "postgresql://user:pass@localhost:5432/db"
            args.backup_dir = td
            args.off_site_copy = ""
            with patch("backup.datetime") as mock_dt:
                mock_dt.utcnow.return_value.strftime.side_effect = lambda fmt: (
                    "20260801T000000Z"
                    if fmt == "%Y%m%dT%H%M%SZ"
                    else "2026-08-01"
                    if fmt == "%Y-%m-%d"
                    else "1"
                    if fmt == "%u"
                    else "01"
                    if fmt == "%d"
                    else ""
                )
                self.assertEqual(main(args), 0)
            monthly_dir = Path(td) / "monthly"
            self.assertTrue(any(monthly_dir.glob("*.sql.gz")))

    @patch("subprocess.run", side_effect=_mock_subprocess_run)
    def test_applies_retention(self, mock_run):
        from backup import main, parse_args

        with tempfile.TemporaryDirectory() as td:
            sys.argv = ["backup.py"]
            args = parse_args()
            args.database_url = "postgresql://user:pass@localhost:5432/db"
            args.backup_dir = td
            args.retention_days = 0
            args.retention_weeks = 0
            args.retention_months = 0
            args.off_site_copy = ""
            self.assertEqual(main(args), 0)
            daily_dir = Path(td) / "daily"
            self.assertFalse(any(daily_dir.glob("*.sql.gz")))


class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.backup_file = Path(self.temp_dir.name) / "backup.sql.gz"
        _write_fake_backup(self.backup_file)
        self.original_argv = sys.argv[:]
        self.original_env = os.environ.copy()

    def tearDown(self):
        sys.argv = self.original_argv
        os.environ.clear()
        os.environ.update(self.original_env)
        self.temp_dir.cleanup()

    def test_fails_when_backup_file_missing(self):
        from restore import main, parse_args

        sys.argv = ["restore.py", "/nonexistent/file.sql.gz"]
        args = parse_args()
        self.assertEqual(main(args), 1)

    @patch("subprocess.run")
    def test_writes_restore_report(self, mock_run):
        from restore import main, parse_args

        mock_run.return_value = MagicMock(returncode=0)
        with tempfile.TemporaryDirectory() as td:
            report_path = Path(td) / "restore-report.json"
            sys.argv = ["restore.py", str(self.backup_file), "scratch"]
            args = parse_args()
            args.pghost = "localhost"
            args.pgport = "5432"
            args.pguser = "stellarwork"
            args.pgpassword = "pass"
            args.drop_if_exists = "0"
            args.report = str(report_path)
            self.assertEqual(main(args), 0)
            self.assertTrue(report_path.exists())
            report = json.loads(report_path.read_text())
            self.assertEqual(report["status"], "success")
            self.assertIn("total_elapsed_ms", report)
            self.assertIn("restore_elapsed_ms", report)

    @patch("subprocess.run")
    def test_measures_restore_time(self, mock_run):
        from restore import main, parse_args

        mock_run.return_value = MagicMock(returncode=0)
        with tempfile.TemporaryDirectory() as td:
            report_path = Path(td) / "restore-report.json"
            sys.argv = ["restore.py", str(self.backup_file), "scratch"]
            args = parse_args()
            args.pghost = "localhost"
            args.pgport = "5432"
            args.pguser = "stellarwork"
            args.pgpassword = "pass"
            args.drop_if_exists = "0"
            args.report = str(report_path)
            self.assertEqual(main(args), 0)
            report = json.loads(report_path.read_text())
            self.assertGreaterEqual(report["restore_elapsed_ms"], 0)


class VerifyTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.backup_file = Path(self.temp_dir.name) / "backup.sql.gz"
        _write_fake_backup(self.backup_file)
        self.original_argv = sys.argv[:]
        self.original_env = os.environ.copy()

    def tearDown(self):
        sys.argv = self.original_argv
        os.environ.clear()
        os.environ.update(self.original_env)
        self.temp_dir.cleanup()

    def test_fails_when_backup_file_missing(self):
        from verify import main, parse_args

        sys.argv = ["verify.py", "/nonexistent/file.sql.gz"]
        args = parse_args()
        self.assertEqual(main(args), 1)

    @patch("subprocess.run")
    def test_validates_checksum(self, mock_run):
        from verify import main, parse_args

        def side_effect(*args, **kwargs):
            cmd = str(kwargs.get("args", args))
            if "information_schema.tables" in cmd:
                return MagicMock(returncode=0, stdout="profiles\njobs\napplications\npayments\nescrow_contracts\n")
            if "pg_constraintdef" in cmd or "pg_constraint c" in cmd:
                return MagicMock(returncode=0, stdout="\n")
            if "pg_indexes" in cmd:
                return MagicMock(returncode=0, stdout="5\n")
            if "pg_extension" in cmd:
                return MagicMock(returncode=0, stdout="pg_trgm\n")
            if "COUNT(*) FROM" in cmd:
                return MagicMock(returncode=0, stdout="10\n")
            return MagicMock(returncode=0, stdout="")

        mock_run.side_effect = side_effect

        with tempfile.TemporaryDirectory() as td:
            report_path = Path(td) / "verify-report.json"
            sys.argv = ["verify.py", str(self.backup_file)]
            args = parse_args()
            args.pghost = "localhost"
            args.pgport = "5432"
            args.pguser = "stellarwork"
            args.pgpassword = "pass"
            args.pgdatabase = "scratch"
            args.report = str(report_path)
            self.assertEqual(main(args), 0)
            self.assertTrue(report_path.exists())
            report = json.loads(report_path.read_text())
            self.assertEqual(report["status"], "success")
            self.assertEqual(report["failed"], 0)

    @patch("subprocess.run")
    def test_detects_missing_table(self, mock_run):
        from verify import main, parse_args

        def side_effect(*args, **kwargs):
            cmd = str(kwargs.get("args", args))
            if "information_schema.tables" in cmd:
                return MagicMock(returncode=0, stdout="profiles\n")
            if "COUNT(*) FROM" in cmd:
                return MagicMock(returncode=0, stdout="0\n")
            return MagicMock(returncode=0, stdout="")

        mock_run.side_effect = side_effect

        with tempfile.TemporaryDirectory() as td:
            report_path = Path(td) / "verify-report.json"
            sys.argv = ["verify.py", str(self.backup_file)]
            args = parse_args()
            args.pghost = "localhost"
            args.pgport = "5432"
            args.pguser = "stellarwork"
            args.pgpassword = "pass"
            args.pgdatabase = "scratch"
            args.report = str(report_path)
            self.assertEqual(main(args), 1)
            report = json.loads(report_path.read_text())
            self.assertEqual(report["status"], "failure")
            self.assertGreater(report["failed"], 0)


if __name__ == "__main__":
    unittest.main()
