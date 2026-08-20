#!/usr/bin/env bash
# scripts/db/seed.sh
# Generate a deterministic, realistic seed dataset for development and testing.
#
# Usage:
#   chmod +x scripts/db/seed.sh
#   ./scripts/db/seed.sh [--seed 42] [--scale small]
#
# Environment variables:
#   DATABASE_URL        PostgreSQL connection string
#   PGUSER              Database user (default: stellarwork)
#   PGPASSWORD           Database password (default: stellarwork_dev)
#   PGHOST              Database host (default: localhost)
#   PGPORT              Database port (default: 5432)
#   PGDATABASE          Database name (default: stellarwork)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$SCRIPT_DIR/seed.py" "$@"
