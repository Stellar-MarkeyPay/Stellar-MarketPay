#!/usr/bin/env bash
# scripts/db/backup.sh
# Create a compressed PostgreSQL backup with checksums and retention.
#
# Usage:
#   chmod +x scripts/db/backup.sh
#   ./scripts/db/backup.sh
#
# Environment variables:
#   DATABASE_URL        postgresql://user:pass@host:5432/dbname
#   BACKUP_DIR          Directory for backups (default: ./backups)
#   RETENTION_DAYS      Days to keep daily backups (default: 7)
#   RETENTION_WEEKS     Weeks to keep weekly backups (default: 4)
#   RETENTION_MONTHS    Months to keep monthly backups (default: 12)
#   OFF_SITE_COPY       Optional: s3://bucket/path or gs://bucket/path

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$SCRIPT_DIR/backup.py" "$@"
