import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from partition_gameday import (
    PartitionGameDayConfig,
    PartitionGameDayResult,
    run_partition_game_day,
    write_partition_reports,
)


class Clock:
    def __init__(self):
        self.value = 0.0

    def monotonic(self):
        return self.value

    def sleep(self, seconds):
        self.value += seconds


class PartitionGameDayTests(unittest.TestCase):
    def config(self):
        return PartitionGameDayConfig(
            primary_url="https://primary/health",
            secondary_url="https://secondary/health",
            public_url="https://public/health",
            secondary_region="secondary-cluster",
            partition_command="inject-net-partition",
            heal_command="heal-net-partition",
            rto_target_seconds=10.0,
            rpo_target_seconds=1.0,
            timeout_seconds=30.0,
            poll_seconds=1.0,
        )

    def test_successful_partition_failover_and_fencing(self):
        clock = Clock()
        calls = {"commands": [], "poll_count": 0}

        def fetch(url):
            if "primary" in url:
                # Before partition: healthy authority. After partition: fenced read-only!
                if "inject-net-partition" in calls["commands"]:
                    return {
                        "status": "degraded",
                        "database": {"writable": False, "fenced": True},
                        "fencing": {"isFenced": True},
                    }
                return {
                    "status": "healthy",
                    "region": "primary-cluster",
                    "database": {"writable": True, "fenced": False},
                }

            if "secondary" in url:
                return {
                    "status": "healthy",
                    "region": "secondary-cluster",
                    "replication": {"currentLagSeconds": 0.2},
                    "database": {"writable": False, "replay_lag_seconds": 0.2},
                }

            # Public URL
            calls["poll_count"] += 1
            if calls["poll_count"] < 3:
                raise OSError("Traffic still in flight")
            return {
                "status": "healthy",
                "region": "secondary-cluster",
                "database": {"writable": True, "generation_token": 2},
                "fencing": {"isFenced": False, "generationToken": 2},
            }

        result = run_partition_game_day(
            self.config(),
            fetch=fetch,
            execute=calls["commands"].append,
            monotonic=clock.monotonic,
            sleep=clock.sleep,
            mode="simulation",
        )

        self.assertTrue(result.passed)
        self.assertTrue(result.split_brain_prevented)
        self.assertTrue(result.fencing_verified)
        self.assertTrue(result.chain_reconciled)
        self.assertEqual(result.failover_region, "secondary-cluster")
        self.assertEqual(calls["commands"], ["inject-net-partition", "heal-net-partition"])
        self.assertLessEqual(result.rto_actual_seconds, 10.0)

    def test_refuses_partition_injection_when_lag_exceeds_rpo(self):
        commands = []

        def fetch(url):
            if "primary" in url:
                return {"status": "healthy", "database": {"writable": True}}
            return {
                "status": "healthy",
                "replication": {"currentLagSeconds": 3.5},
            }

        result = run_partition_game_day(
            self.config(),
            fetch=fetch,
            execute=commands.append,
        )

        self.assertFalse(result.passed)
        self.assertIn("RPO target", result.failure_reason)
        self.assertEqual(commands, [])

    def test_detects_split_brain_vulnerability_when_primary_not_fenced(self):
        clock = Clock()
        calls = {"commands": []}

        def fetch(url):
            if "primary" in url:
                # Flaw: Primary remains writable even after partition!
                return {"status": "healthy", "database": {"writable": True, "fenced": False}}
            if "secondary" in url:
                return {"status": "healthy", "replication": {"currentLagSeconds": 0.1}}
            return {"status": "healthy", "region": "secondary-cluster", "database": {"writable": True}}

        result = run_partition_game_day(
            self.config(),
            fetch=fetch,
            execute=calls["commands"].append,
            monotonic=clock.monotonic,
            sleep=clock.sleep,
        )

        self.assertFalse(result.passed)
        self.assertFalse(result.split_brain_prevented)
        self.assertIn("split-brain", result.failure_reason)

    def test_report_generation(self):
        result = PartitionGameDayResult(
            mode="simulation",
            passed=True,
            split_brain_prevented=True,
            fencing_verified=True,
            chain_reconciled=True,
            rto_target_seconds=10.0,
            rto_actual_seconds=2.45,
            rpo_target_seconds=1.0,
            rpo_actual_seconds=0.12,
            failover_region="secondary-cluster",
            generation_token=2,
            failure_reason=None,
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            json_path = Path(tmpdir) / "report.json"
            md_path = Path(tmpdir) / "report.md"
            write_partition_reports(result, json_path, md_path)

            self.assertTrue(json_path.exists())
            self.assertTrue(md_path.exists())
            self.assertIn("PASS", md_path.read_text())
            self.assertIn("Split-Brain Prevented", md_path.read_text())


if __name__ == "__main__":
    unittest.main()
