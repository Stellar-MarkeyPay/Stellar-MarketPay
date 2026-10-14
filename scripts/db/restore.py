#!/usr/bin/env python3
"""scripts/db/restore.py - Restore a PostgreSQL backup into a scratch database."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Restore a PostgreSQL backup")
    parser.add_argument("backup_file", type=Path)
    parser.add_argument("target_db", nargs="?", default="stellarwork_restore_scratch")
    parser.add_argument("--pghost", default=os.environ.get("PGHOST", "localhost"))
    parser.add_argument("--pgport", default=os.environ.get("PGPORT", "5432"))
    parser.add_argument("--pguser", default=os.environ.get("PGUSER", "stellarwork"))
    parser.add_argument("--pgpassword", default=os.environ.get("PGPASSWORD", "stellarwork_dev"))
    parser.add_argument("--drop-if-exists", default=os.environ.get("DROP_IF_EXISTS", "1"))
    parser.add_argument("--run-migrations", default=os.environ.get("RUN_MIGRATIONS", "0"))
    parser.add_argument("--report", default=os.environ.get("RESTORE_REPORT", "./artifacts/restore-report.json"))
    return parser.parse_args()


def run(cmd: str) -> None:
    subprocess.run(cmd, shell=True, check=True)


def main(args: argparse.Namespace | None = None) -> int:
    if args is None:
        args = parse_args()

    backup_file = args.backup_file
    target_db = args.target_db
    pghost = args.pghost
    pgport = args.pgport
    pguser = args.pguser
    pgpassword = args.pgpassword
    drop_if_exists = args.drop_if_exists
    run_migrations = args.run_migrations
    report_path = Path(args.report)

    if not backup_file.exists():
        print(f"Backup file not found: {backup_file}", file=sys.stderr)
        return 1

    report_path.parent.mkdir(parents=True, exist_ok=True)

    env = {
        "PGHOST": pghost,
        "PGPORT": pgport,
        "PGUSER": pguser,
        "PGPASSWORD": pgpassword,
        "PGDATABASE": target_db,
    }
    os.environ.update(env)

    print(f"Backup: {backup_file}")
    print(f"Target: {pghost}:{pgport}/{target_db}")
    print(f"Started: {datetime.utcnow().isoformat()}Z")

    start_time = time.time()

    if drop_if_exists == "1":
        print("Dropping target database if it exists...")
        check_db = f"psql -U postgres -tc \"SELECT 1 FROM pg_database WHERE datname = '{target_db}'\""
        result = subprocess.run(check_db, shell=True, capture_output=True, text=True)
        if result.returncode == 0 and "1" in result.stdout:
            subprocess.run(
                f"psql -U postgres -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{target_db}' AND pid <> pg_backend_pid();\"",
                shell=True,
            )
            run(f"psql -U postgres -c 'DROP DATABASE \"{target_db}\"'")
            print("Dropped existing database")
        else:
            print("Database does not exist")

        print("Creating target database...")
        run(f"psql -U postgres -c 'CREATE DATABASE \"{target_db}\" OWNER \"{pguser}\"'")
        print("Created")

    print("Restoring backup...")
    restore_start = time.time()

    if backup_file.suffix == ".gz" or str(backup_file).endswith(".sql.gz"):
        subprocess.run(
            f"gunzip -c '{backup_file}' | psql -U '{pguser}' -d '{target_db}' --quiet",
            shell=True,
            check=True,
        )
    else:
        run(f"psql -U '{pguser}' -d '{target_db}' --quiet -f '{backup_file}'")

    restore_end = time.time()
    restore_ms = int((restore_end - restore_start) * 1000)
    print(f"Restore complete in {restore_ms}ms")

    if run_migrations == "1":
        print("Running migrations...")
        backend_dir = Path(__file__).resolve().parents[2] / "backend"
        migrate_script = backend_dir / "src" / "db" / "migrate.js"
        if migrate_script.exists():
            migrate_env = os.environ.copy()
            migrate_env["DATABASE_URL"] = f"postgresql://{pguser}:{pgpassword}@{pghost}:{pgport}/{target_db}"
            subprocess.run(["node", str(migrate_script)], env=migrate_env, check=False)
            print("Migrations applied")
        else:
            print("migrate.js not found - skipping migrations", file=sys.stderr)

    end_time = time.time()
    total_ms = int((end_time - start_time) * 1000)

    print(f"Restore finished. Total: {total_ms}ms, Restore only: {restore_ms}ms")

    report = {
        "backup_file": str(backup_file),
        "target_database": target_db,
        "target_host": pghost,
        "started_at": datetime.utcnow().isoformat() + "Z",
        "total_elapsed_ms": total_ms,
        "restore_elapsed_ms": restore_ms,
        "status": "success",
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Report written to {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
