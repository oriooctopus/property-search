#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/../data"

GTFS_URL="http://web.mta.info/developers/data/nyct/subway/google_transit.zip"
OSM_URL="https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf"

GTFS_FILE="$DATA_DIR/google_transit.zip"
OSM_FILE="$DATA_DIR/new-york-latest.osm.pbf"

FORCE=false
if [[ "${1:-}" == "--force" ]]; then
  FORCE=true
fi

mkdir -p "$DATA_DIR"

download() {
  local url="$1"
  local dest="$2"
  local label="$3"

  if [[ -f "$dest" && "$FORCE" == false ]]; then
    echo "✓ $label already exists at $dest — skipping (use --force to re-download)"
    return
  fi

  echo "⬇ Downloading $label..."
  curl -L --progress-bar -o "$dest" "$url"
  echo "✓ Saved $label to $dest"
}

download "$GTFS_URL" "$GTFS_FILE" "MTA NYC Subway GTFS"
download "$OSM_URL" "$OSM_FILE" "New York State OSM extract"

echo ""
echo "Done. Data files in $DATA_DIR:"
ls -lh "$DATA_DIR"
