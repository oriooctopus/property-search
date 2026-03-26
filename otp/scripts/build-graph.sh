#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/../data"
OTP_DIR="$SCRIPT_DIR/.."

# Check that required data files exist
MISSING=false

if [[ ! -f "$DATA_DIR/google_transit.zip" ]]; then
  echo "ERROR: Missing $DATA_DIR/google_transit.zip"
  MISSING=true
fi

if [[ ! -f "$DATA_DIR/new-york-latest.osm.pbf" ]]; then
  echo "ERROR: Missing $DATA_DIR/new-york-latest.osm.pbf"
  MISSING=true
fi

if [[ "$MISSING" == true ]]; then
  echo ""
  echo "Run ./scripts/download-data.sh first to fetch the required data files."
  exit 1
fi

echo "=== OTP Graph Build ==="
echo ""
echo "Data files:"
ls -lh "$DATA_DIR"
echo ""
echo "Estimated time: 5–15 minutes (depends on machine)"
echo "Memory allocated: 4 GB (-Xmx4G)"
echo ""
echo "Starting OTP graph build via Docker Compose..."
echo ""

cd "$OTP_DIR"
docker compose --profile build up
