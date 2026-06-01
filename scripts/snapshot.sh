#!/usr/bin/env bash
# Snapshot dovetail working tree to a destination directory for public release.
#
# Usage: scripts/snapshot.sh [dest]
#
# If <dest> is omitted, a fresh temp directory is created via mktemp -d and
# printed on the final "[snapshot] ready:" line.
#
# Ships:
#   - tracked source, tests, build files, and public/developer docs
#   - release docs that are intentionally untracked here (README.md, SPEC.md,
#     PERSONA.md, LIMITATIONS.md, docs/maintainer/journey-test-matrix.md,
#     firmware/README.md)
#
# Excludes:
#   - git internals, agent / tooling state (.claude, .codex, .regent, .agents,
#     .vale, .bun-tmp, .venv, node_modules)
#   - secrets (.env*, mise.secrets.toml, mise.local.toml, age identities,
#     private keys / certs by filename: *.pem, *.key, *.p12, *.pfx, *.jks,
#     *.keystore, *.age, id_rsa, id_ed25519, id_ecdsa, *.ppk)
#   - package-manager / IaC token files (.npmrc, .yarnrc(.yml), .netrc,
#     _netrc, .dev.vars*, *.tfstate*, .terraform)
#   - entire data/ workspace (raw / processed / docs / cache — all gitignored
#     and may contain Address-bearing geo source)
#   - private docs (privacy-assurance, privacy-release-checklist)
#   - local working files (temp/, api/bruno/, commit-msg.txt, temp.diff)
#   - pre-redaction / scratch artefacts (*.bak, *.orig, *.rej, *.patch,
#     *.diff, *.swp, *.swo, *~, .~lock.*, ~$*)
#   - OS / IDE noise (.DS_Store, ._*, Thumbs.db, desktop.ini, .idea,
#     .vscode, .fleet, .zed, .history)
#   - build / cache / logs (dist, build, coverage, .nyc_output, .cache,
#     .parcel-cache, .turbo, .next, playwright-report, test-results,
#     *.tsbuildinfo, *.log, __pycache__, *.pyc, .pytest_cache, .mypy_cache,
#     .ruff_cache, firmware/.pio, *.elf, *.uf2, *.hex, *.map)
#   - bulk binary / geospatial (xls(x), pdf, zip, shp + sidecars (.shx,
#     .dbf, .prj, .cpg, .qix, .qpj), gpkg, pmtiles, geojson, kml, kmz,
#     gpx, mbtiles, fgb, parquet, geoparquet, gdb, tif(f), jp2, las, laz)

set -euo pipefail

if [ "$#" -gt 1 ]; then
	echo "usage: $0 [dest]" >&2
	exit 1
fi

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$#" -eq 1 ]; then
	DEST="$1"
else
	DEST="$(mktemp -d -t dovetail-snapshot-XXXXXX)"
	echo "[snapshot] auto dest: $DEST"
fi

# Refuse self-snapshot or ancestor-of-source so an accidental path cannot
# recurse into and overwrite the working tree.
case "$DEST" in
	"$SRC_DIR" | "$SRC_DIR"/* )
		echo "dest must not live inside source: $DEST" >&2
		exit 1
		;;
esac

mkdir -p "$DEST"

if [ -n "$(ls -A "$DEST" 2>/dev/null || true)" ]; then
	echo "dest not empty: $DEST" >&2
	echo "remove or pick a fresh directory before snapshotting." >&2
	exit 1
fi

cd "$SRC_DIR"

EXCLUDES=(
	# Tooling / agent state
	--exclude=.git
	--exclude=.claude
	--exclude=.codex
	--exclude=.agents
	--exclude=.regent
	--exclude=.vale
	--exclude=.venv
	--exclude=.bun-tmp
	--exclude=node_modules
	--exclude=.mcp.json
	--exclude=AGENTS.md
	--exclude=CLAUDE.md

	# Local working / pre-redaction copies
	--exclude=temp
	--exclude=api/bruno
	--exclude=commit-msg.txt
	--exclude=temp.diff
	--exclude=CITATION.cff

	# Top-level data/ workspace — raw / processed / docs / cache all gitignored
	# and may contain Address-bearing geo source. Nothing under data/ is
	# currently shippable; if that changes, add a targeted --include BEFORE
	# this line so rsync first-match-wins keeps the allowed file. The leading
	# slash anchors the pattern to the transfer root so src/data/ and other
	# nested data/ directories are not collaterally excluded.
	--exclude=/data

	# Firmware build artefacts
	--exclude=firmware/build
	--exclude=firmware/.pio
	--exclude='*.elf'
	--exclude='*.uf2'
	--exclude='*.hex'
	--exclude='*.map'

	# Env / dotenv variants
	--exclude=.env
	--exclude=.env.local
	--exclude=.env.production
	--exclude='.env.*.local'
	--exclude=.env.runtime.json
	--exclude=.env.runtime.local.json
	--exclude=.env.runtime.sops.json

	# mise secret / local / private profiles
	--exclude=mise.secrets.toml
	--exclude=mise.local.toml
	--exclude=mise.private.toml

	# Private docs
	--exclude=docs/maintainer/privacy-release-checklist.md
	--exclude=docs/public/privacy-assurance.md

	# Private keys / certs by filename (LEAK_REGEXES scans bodies; filename guard added)
	--exclude='*.pem'
	--exclude='*.key'
	--exclude='*.p12'
	--exclude='*.pfx'
	--exclude='*.jks'
	--exclude='*.keystore'
	--exclude='*.age'
	--exclude=id_rsa
	--exclude=id_ed25519
	--exclude=id_ecdsa
	--exclude='*.ppk'
	--exclude=.sops.yaml

	# Package-manager / IaC token files
	--exclude=.npmrc
	--exclude=.yarnrc
	--exclude=.yarnrc.yml
	--exclude=.netrc
	--exclude=_netrc
	--exclude=.dev.vars
	--exclude='.dev.vars.*'
	--exclude='*.tfstate'
	--exclude='*.tfstate.*'
	--exclude=.terraform

	# Editor swap / lock / backup / patch
	--exclude='*.kate-swp'
	--exclude='*.swp'
	--exclude='*.swo'
	--exclude='*~'
	--exclude='.~lock.*'
	--exclude='~$*'
	--exclude='*.bak'
	--exclude='*.orig'
	--exclude='*.rej'
	--exclude='*.patch'
	--exclude='*.diff'
	--exclude=.directory

	# OS / IDE noise
	--exclude=.DS_Store
	--exclude='._*'
	--exclude=Thumbs.db
	--exclude=desktop.ini
	--exclude=.idea
	--exclude=.vscode
	--exclude=.fleet
	--exclude=.zed
	--exclude=.history

	# Build / cache / logs
	--exclude=dist
	--exclude=build
	--exclude=coverage
	--exclude=.nyc_output
	--exclude=.cache
	--exclude=.parcel-cache
	--exclude=.turbo
	--exclude=.next
	--exclude=playwright-report
	--exclude=test-results
	--exclude='*.tsbuildinfo'
	--exclude='*.log'
	--exclude=__pycache__
	--exclude='*.pyc'
	--exclude=.pytest_cache
	--exclude=.mypy_cache
	--exclude=.ruff_cache

	# Bulk binary office / archive
	--exclude='*.xlsx'
	--exclude='*.xls'
	--exclude='*.pdf'
	--exclude='*.zip'

	# Geospatial — Address-bearing or bulk binary
	--exclude='*.shp'
	--exclude='*.shx'
	--exclude='*.dbf'
	--exclude='*.prj'
	--exclude='*.cpg'
	--exclude='*.qix'
	--exclude='*.qpj'
	--exclude='*.gpkg'
	--exclude='*.pmtiles'
	--exclude='*.geojson'
	--exclude='*.kml'
	--exclude='*.kmz'
	--exclude='*.gpx'
	--exclude='*.mbtiles'
	--exclude='*.fgb'
	--exclude='*.parquet'
	--exclude='*.geoparquet'
	--exclude='*.gdb'
	--exclude='*.tif'
	--exclude='*.tiff'
	--exclude='*.jp2'
	--exclude='*.las'
	--exclude='*.laz'
)

echo "[snapshot] copying tree to $DEST"
rsync -a "${EXCLUDES[@]}" "$SRC_DIR/" "$DEST/"

# Release docs are untracked in the working repo. Copy them explicitly so a
# missing root doc fails loudly before the snapshot is declared shippable.
RELEASE_DOCS=(
	README.md
	SPEC.md
	PERSONA.md
	LIMITATIONS.md
	docs/maintainer/journey-test-matrix.md
	firmware/README.md
)

echo "[snapshot] copying release docs (${#RELEASE_DOCS[@]} files)"
for f in "${RELEASE_DOCS[@]}"; do
	if [ ! -f "$SRC_DIR/$f" ]; then
		echo "missing source: $f" >&2
		exit 1
	fi
	mkdir -p "$DEST/$(dirname "$f")"
	cp "$SRC_DIR/$f" "$DEST/$f"
done

# If a local workspace still suppresses root release docs in .gitignore, strip
# that block so the snapshot repo will track them after `git init && git add -A`.
if [ -f "$DEST/.gitignore" ]; then
	tmp="$(mktemp)"
	awk '
			/^# ───── Release docs/ { skip = 1; next }
		skip && /^$/ { skip = 0; next }
		!skip { print }
	' "$DEST/.gitignore" > "$tmp"
	mv "$tmp" "$DEST/.gitignore"
fi

# Refuse to declare snapshot ready if obvious secret material slipped in.
# Patterns target real key payloads, not literal mention of the prefix in tests
# or docs. Full secret scanning still belongs to gitleaks in the snapshot repo.
LEAK_REGEXES=(
	'AGE-SECRET-KEY-1[A-Z0-9]{50,}'
	'-----BEGIN PRIVATE KEY-----'
	'-----BEGIN OPENSSH PRIVATE KEY-----'
	'-----BEGIN PGP PRIVATE KEY BLOCK-----'
	'-----BEGIN RSA PRIVATE KEY-----'
	'-----BEGIN EC PRIVATE KEY-----'
)

# Skip the snapshot script itself; its regex strings would otherwise self-match.
SCAN_GREP_EXCLUDES=(
	--exclude=snapshot.sh
)

for re in "${LEAK_REGEXES[@]}"; do
	if grep -rIEq "${SCAN_GREP_EXCLUDES[@]}" -- "$re" "$DEST" 2>/dev/null; then
		echo "leak detected: pattern $re in $DEST" >&2
		grep -rIEln "${SCAN_GREP_EXCLUDES[@]}" -- "$re" "$DEST" >&2 || true
		exit 1
	fi
done

# Refuse if a pre-redaction / draft sentinel filename slipped through.
if find "$DEST" \( -name '*-before-*' -o -name '*-draft-*' -o -name '*-wip-*' \) -print -quit | grep -q .; then
	echo "pre-redaction / draft filename pattern detected in $DEST" >&2
	exit 1
fi

echo "[snapshot] ready: $DEST"
echo "[snapshot] release docs copied: ${#RELEASE_DOCS[@]}"
echo ""
echo "next steps:"
echo "  cd $DEST"
echo "  git init && git add -A && git status"
echo "  # review carefully, then:"
echo "  git commit -m 'snapshot: dovetail public release'"
