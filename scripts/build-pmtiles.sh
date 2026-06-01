#!/usr/bin/env bash
# Build PMTiles for offline Demo with GDAL only.
# Run after scripts/build-hazard-layer.sh has produced *.simplified.geojson.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/data/processed"
PMTILES_DIR="$ROOT/data/processed/pmtiles"
mkdir -p "$PMTILES_DIR"

if ! command -v ogr2ogr >/dev/null 2>&1; then
  echo "ogr2ogr (GDAL) required" >&2
  exit 1
fi

if ! ogr2ogr --formats 2>/dev/null | grep -q "PMTiles"; then
  echo "GDAL PMTiles driver required. Use GDAL 3.8+ with PMTiles write support." >&2
  exit 1
fi

DEBRIS="$OUT/mataian-debris-flow.simplified.geojson"
LANDSLIDE="$OUT/mataian-large-landslide.simplified.geojson"
GPKG="$PMTILES_DIR/hualien-hazard.gpkg"
PMTILES_OUT="$PMTILES_DIR/hualien-hazard.pmtiles"

for input in "$DEBRIS" "$LANDSLIDE"; do
  [[ -f "$input" ]] || {
    echo "missing input: $input (run scripts/build-hazard-layer.sh first)" >&2
    exit 1
  }
done

# Use GeoPackage as the durable staging format so each source remains a named
# layer. That keeps future additions (flood zones, shelters, roads) append-only.
rm -f "$GPKG" "$PMTILES_OUT"
ogr2ogr -f GPKG "$GPKG" "$DEBRIS" \
  -nln debris_flow \
  -lco GEOMETRY_NAME=geom \
  -overwrite
ogr2ogr -f GPKG "$GPKG" "$LANDSLIDE" \
  -nln large_landslide \
  -lco GEOMETRY_NAME=geom \
  -append

ogr2ogr -f PMTiles "$PMTILES_OUT" "$GPKG" \
  -dsco MINZOOM=8 \
  -dsco MAXZOOM=15 \
  -dsco NAME=hualien_hazard \
  -dsco DESCRIPTION="Hualien hazard overlay from public redacted GDAL pipeline" \
  -dsco TYPE=overlay

echo
echo "== PMTiles ready =="
ls -lh "$PMTILES_OUT"
echo
echo "== layer summary =="
ogrinfo "$PMTILES_OUT" -so
echo "Serve at: /demo/maps/hualien-hazard.pmtiles"
