#!/usr/bin/env bash
set -euo pipefail

# Roll back lazily migrated, still-v1-representable records and then reinstall
# the previously installed v1 WASM. New streams or amended escrows deliberately
# fail the on-chain rollback guard and must remain on a known-good v2 WASM.
#
# Usage:
#   scripts/rollback-escrow-v2.sh \
#     CONTRACT_ID ADMIN_SOURCE NETWORK V1_WASM_HASH JOB_ID [JOB_ID ...]

if [[ $# -lt 5 ]]; then
  echo "usage: $0 CONTRACT_ID ADMIN_SOURCE NETWORK V1_WASM_HASH JOB_ID [JOB_ID ...]" >&2
  exit 64
fi

contract_id=$1
admin_source=$2
network=$3
v1_wasm_hash=$4
shift 4

# `--source` accepts an identity alias or secret key, while contract arguments
# require the corresponding public address. Resolve it once rather than
# assuming that both command-line values have the same representation.
admin_address=$(stellar keys address "$admin_source")

for job_id in "$@"; do
  stellar contract invoke \
    --id "$contract_id" \
    --source "$admin_source" \
    --network "$network" \
    -- rollback_escrow_v2 \
    --job_id "$job_id" \
    --admin "$admin_address"
done

stellar contract invoke \
  --id "$contract_id" \
  --source "$admin_source" \
  --network "$network" \
  -- upgrade \
  --new_wasm_hash "$v1_wasm_hash"

stellar contract invoke \
  --id "$contract_id" \
  --network "$network" \
  -- get_version
