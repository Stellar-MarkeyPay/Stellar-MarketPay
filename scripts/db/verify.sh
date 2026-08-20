#!/usr/bin/env bash
# scripts/db/verify.sh
# Verify PostgreSQL backup integrity and restored data.
#
# Usage:
#   chmod +x scripts/db/verify.sh
#   ./scripts/db/verify.sh /path/to/backup.sql.gz
#
# Environment variables:
#   DATABASE_URL        Connection string for the restored database
#   PGHOST              Target host (default: localhost)
#   PGPORT              Target port (default: 5432)
#   PGUSER              Target user (default: stellarwork)
#   PGPASSWORD           Target password (default: stellarwork_dev)
#   PGDATABASE          Target database name (default: stellarwork_restore_scratch)
#   EXPECTED_ROW_TOLERANCE  Percent tolerance for row-count drift (default: 1)
#   VERIFY_REPORT       Path to write JSON report (default: ./artifacts/verify-report.json)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$SCRIPT_DIR/verify.py" "$@"
