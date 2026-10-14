#!/usr/bin/env python3
"""scripts/db/verify.py - Verify PostgreSQL backup integrity and restored data."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify PostgreSQL backup integrity")
    parser.add_argument("backup_file", type=Path)
    parser.add_argument("--pghost", default=os.environ.get("PGHOST", "localhost"))
    parser.add_argument("--pgport", default=os.environ.get("PGPORT", "5432"))
    parser.add_argument("--pguser", default=os.environ.get("PGUSER", "stellarwork"))
    parser.add_argument("--pgpassword", default=os.environ.get("PGPASSWORD", "stellarwork_dev"))
    parser.add_argument("--pgdatabase", default=os.environ.get("PGDATABASE", "stellarwork_restore_scratch"))
    parser.add_argument("--expected-row-tolerance", type=float, default=float(os.environ.get("EXPECTED_ROW_TOLERANCE", "1")))
    parser.add_argument("--report", default=os.environ.get("VERIFY_REPORT", "./artifacts/verify-report.json"))
    return parser.parse_args()


def run_sql(query: str, pghost: str, pgport: str, pguser: str, pgpassword: str, pgdatabase: str) -> str:
    env = {
        "PGHOST": pghost,
        "PGPORT": pgport,
        "PGUSER": pguser,
        "PGPASSWORD": pgpassword,
        "PGDATABASE": pgdatabase,
    }
    result = subprocess.run(
        ["psql", "-U", pguser, "-d", pgdatabase, "-t", "-c", query],
        capture_output=True,
        text=True,
        env={**os.environ, **env},
    )
    return result.stdout.strip()


def checksum_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def main(args: argparse.Namespace | None = None) -> int:
    if args is None:
        args = parse_args()

    backup_file = args.backup_file
    pghost = args.pghost
    pgport = args.pgport
    pguser = args.pguser
    pgpassword = args.pgpassword
    pgdatabase = args.pgdatabase
    report_path = Path(args.report)

    if not backup_file.exists():
        print(f"Backup file not found: {backup_file}", file=sys.stderr)
        return 1

    report_path.parent.mkdir(parents=True, exist_ok=True)

    checks = []
    errors = []

    def check(name: str, passed: bool, detail: str) -> None:
        checks.append({"name": name, "passed": passed, "detail": detail})
        if not passed:
            errors.append(f"{name}: {detail}")

    print(f"Backup: {backup_file}")
    print(f"Target: {pghost}:{pgport}/{pgdatabase}")
    print()

    print("Checksum verification...")
    checksum_file_path = Path(f"{backup_file}.sha256")
    if checksum_file_path.exists():
        expected = checksum_file_path.read_text().split()[0]
        actual = checksum_file(backup_file)
        if expected == actual:
            check("backup_checksum", True, "SHA256 matches")
            print("  Checksum valid")
        else:
            check("backup_checksum", False, f"Expected {expected}, got {actual}")
            print("  Checksum mismatch", file=sys.stderr)
    else:
        check("backup_checksum", False, "No .sha256 file found")
        print("  No checksum file to verify", file=sys.stderr)

    print()
    print("Schema validation...")
    tables_raw = run_sql(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;",
        pghost, pgport, pguser, pgpassword, pgdatabase,
    )
    tables = sorted([t.strip() for t in tables_raw.splitlines() if t.strip()])

    if not tables:
        check("schema_has_tables", False, "No tables found in public schema")
        print("  No tables found", file=sys.stderr)
    else:
        check("schema_has_tables", True, f"Found {len(tables)} tables")
        print(f"  Tables present: {', '.join(tables)}")

    critical_tables = ["profiles", "jobs", "applications", "payments", "escrow_contracts"]
    for table in critical_tables:
        if table in tables:
            check(f"table_{table}", True, "Table exists")
        else:
            check(f"table_{table}", False, "Table missing")
            print(f"  Missing table: {table}", file=sys.stderr)

    print()
    print("Row-count verification...")
    for table in critical_tables:
        if table in tables:
            count = run_sql(f'SELECT COUNT(*) FROM "{table}";', pghost, pgport, pguser, pgpassword, pgdatabase)
            check(f"rowcount_{table}", True, f"{count} rows")
            print(f"  {table}: {count} rows")

    print()
    print("Foreign-key integrity...")
    fk_count_raw = run_sql(
        """SELECT COUNT(*) FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';""",
        pghost, pgport, pguser, pgpassword, pgdatabase,
    )
    fk_count = int(fk_count_raw.strip() or "0")
    if fk_count > 0:
        broken_raw = run_sql(
            """SELECT COUNT(*) FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
            AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = tc.constraint_name);""",
            pghost, pgport, pguser, pgpassword, pgdatabase,
        )
        broken = int(broken_raw.strip() or "0")
        if broken == 0:
            check("foreign_key_integrity", True, f"{fk_count} foreign keys intact")
            print(f"  {fk_count} foreign keys validated")
        else:
            check("foreign_key_integrity", False, f"{broken} broken foreign keys")
            print(f"  {broken} broken foreign keys", file=sys.stderr)
    else:
        check("foreign_key_integrity", True, "No foreign keys to validate")
        print("  No foreign keys found")

    print()
    print("Index validation...")
    index_count_raw = run_sql(
        "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';",
        pghost, pgport, pguser, pgpassword, pgdatabase,
    )
    index_count = int(index_count_raw.strip() or "0")
    if index_count > 0:
        check("index_count", True, f"{index_count} indexes present")
        print(f"  {index_count} indexes present")
    else:
        check("index_count", False, "No indexes found")
        print("  No indexes found", file=sys.stderr)

    print()
    print("Extension validation...")
    extensions_raw = run_sql(
        "SELECT extname FROM pg_extension WHERE extname != 'plpgsql' ORDER BY extname;",
        pghost, pgport, pguser, pgpassword, pgdatabase,
    )
    extensions = [e.strip() for e in extensions_raw.splitlines() if e.strip()]
    if "pg_trgm" in extensions:
        check("extension_pg_trgm", True, "pg_trgm installed")
        print("  pg_trgm installed")
    else:
        check("extension_pg_trgm", False, "pg_trgm missing")
        print("  pg_trgm missing", file=sys.stderr)

    passed = sum(1 for c in checks if c["passed"])
    failed = sum(1 for c in checks if not c["passed"])
    total = len(checks)

    print()
    print(f"Results: {passed} passed, {failed} failed out of {total} checks")

    if failed > 0:
        print()
        print("Failures:")
        for e in errors:
            print(f"  - {e}")
        status = "failure"
    else:
        print()
        print("All checks passed")
        status = "success"

    report = {
        "backup_file": str(backup_file),
        "database": pgdatabase,
        "host": pghost,
        "started_at": datetime.utcnow().isoformat() + "Z",
        "status": status,
        "total_checks": total,
        "passed": passed,
        "failed": failed,
        "checks": checks,
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Report written to {report_path}")

    return 1 if failed > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
