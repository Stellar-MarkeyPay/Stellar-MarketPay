#!/usr/bin/env python3
"""scripts/db/backup.py - PostgreSQL backup with checksums and retention."""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a PostgreSQL backup")
    parser.add_argument("--backup-dir", default=os.environ.get("BACKUP_DIR", "./backups"))
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""))
    parser.add_argument("--retention-days", type=int, default=int(os.environ.get("RETENTION_DAYS", "7")))
    parser.add_argument("--retention-weeks", type=int, default=int(os.environ.get("RETENTION_WEEKS", "4")))
    parser.add_argument("--retention-months", type=int, default=int(os.environ.get("RETENTION_MONTHS", "12")))
    parser.add_argument("--off-site-copy", default=os.environ.get("OFF_SITE_COPY", ""))
    return parser.parse_args()


def checksum_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd: str) -> None:
    subprocess.run(cmd, shell=True, check=True)


def main(args: argparse.Namespace | None = None) -> int:
    if args is None:
        args = parse_args()

    database_url = args.database_url
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1

    backup_dir = Path(args.backup_dir)
    daily_dir = backup_dir / "daily"
    weekly_dir = backup_dir / "weekly"
    monthly_dir = backup_dir / "monthly"

    for d in (daily_dir, weekly_dir, monthly_dir):
        d.mkdir(parents=True, exist_ok=True)

    now = datetime.utcnow()
    timestamp = now.strftime("%Y%m%dT%H%M%SZ")
    day_of_week = now.strftime("%u")
    day_of_month = now.strftime("%d")

    filename = f"stellarwork_{timestamp}.sql.gz"
    checksum_filename = f"{filename}.sha256"
    globals_filename = f"stellarwork_globals_{timestamp}.sql.gz"
    globals_checksum_filename = f"{globals_filename}.sha256"

    print(f"Database: {database_url.replace('://.*?@', '://***:***@')}")
    print(f"Backup dir: {backup_dir}")

    print("Dumping globals (roles, tablespaces)...")
    run(f"pg_dumpall -g '{database_url}' | gzip > '{monthly_dir / globals_filename}'")
    checksum = checksum_file(monthly_dir / globals_filename)
    (monthly_dir / globals_checksum_filename).write_text(f"{checksum}  {globals_filename}\n")
    print("Globals dumped and checksummed")

    print("Dumping database...")
    run(f"pg_dump '{database_url}' | gzip > '{daily_dir / filename}'")
    checksum = checksum_file(daily_dir / filename)
    (daily_dir / checksum_filename).write_text(f"{checksum}  {filename}\n")
    print(f"Backup complete: {filename}")

    if day_of_week == "7":
        shutil.copy(daily_dir / filename, weekly_dir / filename)
        shutil.copy(daily_dir / checksum_filename, weekly_dir / checksum_filename)
        print("Weekly backup promoted")

    if day_of_month == "01":
        shutil.copy(daily_dir / filename, monthly_dir / filename)
        shutil.copy(daily_dir / checksum_filename, monthly_dir / checksum_filename)
        print("Monthly backup promoted")

    if args.off_site_copy:
        print(f"Copying to off-site storage: {args.off_site_copy}")
        if args.off_site_copy.startswith("s3://") and shutil.which("aws"):
            run(f"aws s3 cp '{daily_dir / filename}' '{args.off_site_copy}/daily/{filename}'")
            run(f"aws s3 cp '{daily_dir / checksum_filename}' '{args.off_site_copy}/daily/{checksum_filename}'")
            run(f"aws s3 cp '{monthly_dir / globals_filename}' '{args.off_site_copy}/monthly/{globals_filename}'")
            run(f"aws s3 cp '{monthly_dir / globals_checksum_filename}' '{args.off_site_copy}/monthly/{globals_checksum_filename}'")
            print("Off-site copy complete (S3)")
        elif args.off_site_copy.startswith("gs://") and shutil.which("gsutil"):
            run(f"gsutil cp '{daily_dir / filename}' '{args.off_site_copy}/daily/{filename}'")
            run(f"gsutil cp '{daily_dir / checksum_filename}' '{args.off_site_copy}/daily/{checksum_filename}'")
            run(f"gsutil cp '{monthly_dir / globals_filename}' '{args.off_site_copy}/monthly/{globals_filename}'")
            run(f"gsutil cp '{monthly_dir / globals_checksum_filename}' '{args.off_site_copy}/monthly/{globals_checksum_filename}'")
            print("Off-site copy complete (GCS)")
        else:
            print("Off-site copy skipped: no supported CLI or unsupported scheme", file=sys.stderr)
    else:
        print("OFF_SITE_COPY not set - skipping off-site replication")

    print("Applying retention policy...")
    import time

    now_ts = time.time()
    for f in daily_dir.glob("*.sql.gz"):
        if now_ts - f.stat().st_mtime > args.retention_days * 86400:
            f.unlink()
    for f in daily_dir.glob("*.sha256"):
        if now_ts - f.stat().st_mtime > args.retention_days * 86400:
            f.unlink()
    for f in weekly_dir.glob("*.sql.gz"):
        if now_ts - f.stat().st_mtime > args.retention_weeks * 7 * 86400:
            f.unlink()
    for f in weekly_dir.glob("*.sha256"):
        if now_ts - f.stat().st_mtime > args.retention_weeks * 7 * 86400:
            f.unlink()
    for f in monthly_dir.glob("*.sql.gz"):
        if now_ts - f.stat().st_mtime > args.retention_months * 30 * 86400:
            f.unlink()
    for f in monthly_dir.glob("*.sha256"):
        if now_ts - f.stat().st_mtime > args.retention_months * 30 * 86400:
            f.unlink()
    print("Retention applied")

    print("Backup inventory:")
    for tier in (daily_dir, weekly_dir, monthly_dir):
        for f in sorted(tier.glob("*.sql.gz")):
            print(f"  {f.name} ({f.stat().st_size // 1024}KB)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
