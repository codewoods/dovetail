#!/usr/bin/env bash
# Build-time GDAL pipeline: 農業部 SHP → WGS84 GeoJSON → 馬太鞍裁切 → 隱碼 → 簡化
# Not used at Worker runtime. Outputs feed analysis-component static layer.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW="$ROOT/data/raw"
OUT="$ROOT/data/processed"
mkdir -p "$RAW" "$OUT"

# 馬太鞍 / 光復鄉 demo 範圍 (涵蓋大富、大馬、馬太鞍部落)
CLIP_LNG_MIN=121.36
CLIP_LAT_MIN=23.55
CLIP_LNG_MAX=121.50
CLIP_LAT_MAX=23.70

DEBRIS_URL='https://data.moa.gov.tw/OpenData/GetOpenDataFile.aspx?FileType=SHP&RID=71085&id=J73'
LANDSLIDE_URL='https://data.moa.gov.tw/OpenData/GetOpenDataFile.aspx?FileType=SHP&RID=66657&id=J75'
DEBRIS_ZIP="$RAW/debris-flow-impact-115.zip"
LANDSLIDE_ZIP="$RAW/large-landslide-impact-115.zip"
DEBRIS_DIR="$RAW/debris-flow-impact-115"
LANDSLIDE_DIR="$RAW/large-landslide-impact-115"

# 1. Fetch raw SHP if missing
download_if_missing() {
  local url="$1" out="$2"
  [[ -f "$out" ]] && { echo "skip fetch: $out"; return; }
  echo "fetch $out"
  curl -sSL "$url" -o "$out"
}

download_if_missing "$DEBRIS_URL" "$DEBRIS_ZIP"
download_if_missing "$LANDSLIDE_URL" "$LANDSLIDE_ZIP"

# 2. Unzip
[[ -d "$DEBRIS_DIR" ]] || unzip -o "$DEBRIS_ZIP" -d "$DEBRIS_DIR" >/dev/null
[[ -d "$LANDSLIDE_DIR" ]] || unzip -o "$LANDSLIDE_ZIP" -d "$LANDSLIDE_DIR" >/dev/null

DEBRIS_SHP=$(find "$DEBRIS_DIR" -name '*.shp' | head -n1)
LANDSLIDE_SHP=$(find "$LANDSLIDE_DIR" -name '*.shp' | head -n1)

# 3. SHP (TWD97 / EPSG:3826) → WGS84 GeoJSON, filter Hualien only
# -t_srs EPSG:4326: reproject to WGS84 for web mapping
# -where: server-side filter avoids loading non-Hualien features into memory
convert() {
  local shp="$1" out="$2"
  echo "convert $shp -> $out"
  ogr2ogr -f GeoJSON -t_srs EPSG:4326 \
    -where "County='花蓮縣'" \
    "$out.tmp" "$shp"
  mv "$out.tmp" "$out"
}

convert "$DEBRIS_SHP" "$OUT/hualien-debris-flow-impact-115.geojson"
convert "$LANDSLIDE_SHP" "$OUT/hualien-large-landslide-impact-115.geojson"

# 4. Clip to 馬太鞍 demo bbox for Demo / PMTiles size budget
# -clipsrc 用 lng_min lat_min lng_max lat_max
clip_bbox() {
  local in="$1" out="$2"
  echo "clip $in -> $out"
  ogr2ogr -f GeoJSON \
    -clipsrc "$CLIP_LNG_MIN" "$CLIP_LAT_MIN" "$CLIP_LNG_MAX" "$CLIP_LAT_MAX" \
    "$out.tmp" "$in"
  mv "$out.tmp" "$out"
}

clip_bbox "$OUT/hualien-debris-flow-impact-115.geojson" "$OUT/mataian-debris-flow.geojson"
clip_bbox "$OUT/hualien-large-landslide-impact-115.geojson" "$OUT/mataian-large-landslide.geojson"

# 5. Redact Address field (SOURCES.md §privacy note)
# 原始與 Hualien 全集含受保護住戶 Address; demo / public output 必須 redact
redact() {
  local in="$1" out="$2"
  echo "redact $in -> $out"
  jq '(.features[].properties.Address) = null
      | (.features[].properties |= del(.Address))' \
    "$in" > "$out.tmp"
  mv "$out.tmp" "$out"
}

redact "$OUT/hualien-debris-flow-impact-115.geojson" "$OUT/hualien-debris-flow-impact-115.redacted.geojson"
redact "$OUT/hualien-large-landslide-impact-115.geojson" "$OUT/hualien-large-landslide-impact-115.redacted.geojson"
redact "$OUT/mataian-debris-flow.geojson" "$OUT/mataian-debris-flow.redacted.geojson"
redact "$OUT/mataian-large-landslide.geojson" "$OUT/mataian-large-landslide.redacted.geojson"

# 6. Simplify polygon detail for PMTiles / front-end bundle
# -simplify tolerance in degrees ~ 0.0001 ≒ 11 meters at this latitude
simplify() {
  local in="$1" out="$2"
  echo "simplify $in -> $out"
  ogr2ogr -f GeoJSON -simplify 0.0001 "$out.tmp" "$in"
  mv "$out.tmp" "$out"
}

simplify "$OUT/mataian-debris-flow.redacted.geojson" "$OUT/mataian-debris-flow.simplified.geojson"
simplify "$OUT/mataian-large-landslide.redacted.geojson" "$OUT/mataian-large-landslide.simplified.geojson"

# 7. Report sizes
echo
echo "== output sizes =="
ls -lh "$OUT" | awk 'NR>1 {printf "  %s  %s\n", $5, $NF}'
