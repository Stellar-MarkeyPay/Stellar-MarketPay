#!/usr/bin/env bash
# scripts/db/restore.sh
# Restore a PostgreSQL backup into a scratch database and measure elapsed time.
#
# Usage:
#   chmod +x scripts/db/restore.sh
#   ./scripts/db/restore.sh /path/to/backup.sql.gz [TARGET_DATABASE]
#
# Environment variables:
#   DATABASE_URL        Connection string for the restored database
#   PGHOST              Target host (default: localhost)
#   PGPORT              Target port (default: 5432)
#   PGUSER              Target user (default: stellarwork)
#   PGPASSWORD           Target password (default: stellarwork_dev)
#   PGDATABASE          Target database name (default: stellarwork_restore_scratch)
#   DROP_IF_EXISTS      Set to 1 to drop the target database before restore (default: 1)
#   RUN_MIGRATIONS      Set to 1 to run backend migrations after restore (default: 0)
#   RESTORE_REPORT      Path to write JSON timing report (default: ./artifacts/restore-report.json)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$SCRIPT_DIR/restore.py" "$@"
