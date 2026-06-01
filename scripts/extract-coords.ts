#!/usr/bin/env bun
/**
 * Coordinate audit dump.
 *
 * Scans repo surfaces for hard-coded lat/lng so the maintainer can manually
 * verify each unique point against public references before any coord_resolution
 * coarsening or projection change ships. Output lands in temp/coord-audit/
 * (gitignored) — never re-commit raw output.
 *
 * Scope:
 *   - markers: scalar lat/lng pairs in current tracked/untracked repo files
 *   - polygons: coordinate vertex arrays in TS hazard zones + GeoJSON features
 *   - cross-references DEMO_SHELTERS so demo shelter coordinates are flagged
 *
 * Usage:
 *   bun scripts/extract-coords.ts
 *
 * Run from the repo root. Optional env DOVETAIL_COORD_OUT overrides the output
 * directory. No external dependencies — Bun stdlib only.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { DEMO_SHELTERS } from "../src/demo/shelters.ts";

interface MarkerRow {
	readonly file: string;
	readonly line: number;
	readonly lat: number;
	readonly lng: number;
	readonly context: string;
	readonly category: string;
	readonly shelter_match: string;
}

interface PolygonRow {
	readonly file: string;
	readonly layer: string;
	readonly vertices: number;
	readonly min_lat: number;
	readonly max_lat: number;
	readonly min_lng: number;
	readonly max_lng: number;
	readonly centroid_lat: number;
	readonly centroid_lng: number;
}

/** Walk a directory tree, skipping the gitignored / vendored noise. */
const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	".bun-tmp",
	"data/raw",
	"firmware/build",
	"src/vendor",
	"temp",
	".wrangler",
	".venv",
	".codex",
	".regent",
]);

const CODE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".mjs",
	".cjs",
	".c",
	".h",
	".json",
	".jsonc",
	".yml",
	".yaml",
	".md",
	".mmd",
	".geojson",
	".csv",
	".txt",
	".toml",
	".sh",
	".html",
	".css",
]);

const isSkipped = (path: string): boolean => {
	const norm = path.replaceAll("\\", "/").replace(/^\.\//, "");
	for (const skip of SKIP_DIRS)
		if (
			norm === skip ||
			norm.startsWith(`${skip}/`) ||
			norm.includes(`/${skip}/`) ||
			norm.endsWith(`/${skip}`)
		)
			return true;
	return false;
};

const walk = (root: string): readonly string[] => {
	if (!existsSync(root)) return [];
	const stat = statSync(root);
	if (!stat.isDirectory()) return [root];
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const child = join(root, entry.name);
		if (isSkipped(child)) return [];
		if (entry.isDirectory()) return walk(child);
		const ext = entry.name.slice(entry.name.lastIndexOf("."));
		return CODE_EXTENSIONS.has(ext) ? [child] : [];
	});
};

const categorize = (path: string): string => {
	if (path.startsWith("test/")) return "test_fixture";
	if (path.startsWith("examples/") || path.startsWith("api/bruno/"))
		return "public_fixture";
	if (path.startsWith("docs/")) return "doc_sample";
	if (path.startsWith("data/processed/")) return "processed_geo";
	if (path.startsWith("src/demo/")) return "demo_source";
	if (path.startsWith("src/data/")) return "static_data";
	return "source";
};

const SHELTER_LOOKUP = new Map<string, string>(
	DEMO_SHELTERS.map((s) => [`${s.lat.toFixed(6)},${s.lng.toFixed(6)}`, s.name]),
);

const matchShelter = (lat: number, lng: number): string =>
	SHELTER_LOOKUP.get(`${lat.toFixed(6)},${lng.toFixed(6)}`) ?? "";

const COORD_SCALE = 10_000_000;

interface MarkerPattern {
	readonly pattern: RegExp;
	readonly scale: number;
}

/**
 * Current snapshot audit catches the forms that can leak real points: object
 * literals, docs query strings, and firmware fixed-point test fixtures.
 */
const MARKER_PATTERNS: readonly MarkerPattern[] = [
	{
		pattern:
			/(?:"?(?:lat|latitude)"?\s*:\s*)(-?\d+\.\d+)\s*,?\s*(?:"?(?:lng|longitude)"?\s*:\s*)(-?\d+\.\d+)/g,
		scale: 1,
	},
	{
		pattern: /(?:lat|latitude)=(-?\d+\.\d+)&(?:lng|longitude)=(-?\d+\.\d+)/g,
		scale: 1,
	},
	{
		pattern: /\.?lat_fp\s*=\s*(-?\d+)\s*,?\s*\n\s*\.?lng_fp\s*=\s*(-?\d+)/g,
		scale: 1 / COORD_SCALE,
	},
];

const inTaiwanBbox = (lat: number, lng: number): boolean =>
	lat >= 21 && lat <= 26 && lng >= 119 && lng <= 123;

const lineOf = (text: string, index: number): number =>
	(text.slice(0, index).match(/\n/g)?.length ?? 0) + 1;

const snippetAt = (text: string, index: number): string => {
	const start = text.lastIndexOf("\n", Math.max(0, index - 200));
	const end = text.indexOf("\n", index + 200);
	return text
		.slice(start + 1, end === -1 ? text.length : end)
		.replaceAll("\n", " | ")
		.replaceAll(/\s+/g, " ")
		.trim()
		.slice(0, 220);
};

const extractMarkers = (file: string, text: string): readonly MarkerRow[] => {
	const rows: MarkerRow[] = [];
	for (const { pattern, scale } of MARKER_PATTERNS) {
		for (const match of text.matchAll(pattern)) {
			const lat = Number(match[1]) * scale;
			const lng = Number(match[2]) * scale;
			if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
			if (!inTaiwanBbox(lat, lng)) continue;
			const idx = match.index ?? 0;
			rows.push({
				file,
				line: lineOf(text, idx),
				lat,
				lng,
				context: snippetAt(text, idx),
				category: categorize(file),
				shelter_match: matchShelter(lat, lng),
			});
		}
	}
	return rows;
};

/**
 * Polygon vertex arrays in src/data/hazard-zones.ts follow GeoJSON convention
 * [lng, lat]. Use bbox + centroid so the manual reviewer can compare against
 * the public MOA / NLSC datasets without diffing thousands of vertices.
 */
const POLYGON_REGEX =
	/coordinates\s*:\s*\[\s*((?:\[\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*\]\s*,?\s*)+)\]/g;

const VERTEX_REGEX = /\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]/g;

const polygonBboxFromVertices = (
	vertices: readonly (readonly [number, number])[],
): {
	minLat: number;
	maxLat: number;
	minLng: number;
	maxLng: number;
	cLat: number;
	cLng: number;
} => {
	let minLat = Infinity;
	let maxLat = -Infinity;
	let minLng = Infinity;
	let maxLng = -Infinity;
	let sumLat = 0;
	let sumLng = 0;
	for (const [lng, lat] of vertices) {
		if (lat < minLat) minLat = lat;
		if (lat > maxLat) maxLat = lat;
		if (lng < minLng) minLng = lng;
		if (lng > maxLng) maxLng = lng;
		sumLat += lat;
		sumLng += lng;
	}
	const n = Math.max(1, vertices.length);
	return {
		minLat,
		maxLat,
		minLng,
		maxLng,
		cLat: sumLat / n,
		cLng: sumLng / n,
	};
};

const extractTsPolygons = (
	file: string,
	text: string,
): readonly PolygonRow[] => {
	const rows: PolygonRow[] = [];
	let polygonIndex = 0;
	for (const match of text.matchAll(POLYGON_REGEX)) {
		const body = match[1] ?? "";
		const vertices: [number, number][] = [];
		for (const v of body.matchAll(VERTEX_REGEX))
			vertices.push([Number(v[1]), Number(v[2])]);
		if (vertices.length === 0) continue;
		const bb = polygonBboxFromVertices(vertices);
		rows.push({
			file,
			layer: `polygon_${polygonIndex++}`,
			vertices: vertices.length,
			min_lat: bb.minLat,
			max_lat: bb.maxLat,
			min_lng: bb.minLng,
			max_lng: bb.maxLng,
			centroid_lat: bb.cLat,
			centroid_lng: bb.cLng,
		});
	}
	return rows;
};

/** GeoJSON FeatureCollection: bbox per feature, name layer from properties when present. */
const extractGeoJsonPolygons = (
	file: string,
	text: string,
): readonly PolygonRow[] => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return [];
	}
	if (typeof parsed !== "object" || parsed === null) return [];
	const fc = parsed as { features?: unknown };
	if (!Array.isArray(fc.features)) return [];
	const rows: PolygonRow[] = [];
	fc.features.forEach((feature, index) => {
		if (typeof feature !== "object" || feature === null) return;
		const f = feature as {
			geometry?: { type?: string; coordinates?: unknown };
			properties?: Record<string, unknown>;
		};
		const coords = f.geometry?.coordinates;
		if (!Array.isArray(coords)) return;
		const vertices: [number, number][] = [];
		const flatten = (node: unknown): void => {
			if (!Array.isArray(node)) return;
			if (
				node.length === 2 &&
				typeof node[0] === "number" &&
				typeof node[1] === "number"
			) {
				vertices.push([node[0], node[1]]);
				return;
			}
			for (const child of node) flatten(child);
		};
		flatten(coords);
		if (vertices.length === 0) return;
		const bb = polygonBboxFromVertices(vertices);
		const props = f.properties ?? {};
		const layer = String(
			props.Debrisno ?? props.Islno ?? props.Vill ?? `feature_${index}`,
		);
		rows.push({
			file,
			layer,
			vertices: vertices.length,
			min_lat: bb.minLat,
			max_lat: bb.maxLat,
			min_lng: bb.minLng,
			max_lng: bb.maxLng,
			centroid_lat: bb.cLat,
			centroid_lng: bb.cLng,
		});
	});
	return rows;
};

const csvCell = (value: string | number): string => {
	const text = String(value);
	return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const csvRowOf = (cells: readonly (string | number)[]): string =>
	cells.map(csvCell).join(",");

interface UniqueAggregate {
	readonly lat: number;
	readonly lng: number;
	readonly source_count: number;
	readonly categories: readonly string[];
	readonly shelter_match: string;
	readonly sources: readonly string[];
}

const aggregateUnique = (
	rows: readonly MarkerRow[],
): readonly UniqueAggregate[] => {
	const groups = new Map<string, MarkerRow[]>();
	for (const row of rows) {
		const key = `${row.lat.toFixed(6)},${row.lng.toFixed(6)}`;
		const bucket = groups.get(key) ?? [];
		bucket.push(row);
		groups.set(key, bucket);
	}
	return [...groups.entries()]
		.map(([_, bucket]) => {
			const sample = bucket[0]!;
			return {
				lat: sample.lat,
				lng: sample.lng,
				source_count: bucket.length,
				categories: [...new Set(bucket.map((r) => r.category))].sort(),
				shelter_match: sample.shelter_match,
				sources: bucket.map((r) => `${r.file}:${r.line}`),
			};
		})
		.sort((a, b) => (a.lat !== b.lat ? a.lat - b.lat : a.lng - b.lng));
};

const ensureDir = (path: string): void => {
	if (!existsSync(path)) mkdirSync(path, { recursive: true });
};

const writeFileText = (path: string, body: string): void => {
	ensureDir(dirname(path));
	Bun.write(path, body);
};

const formatCoordNumber = (value: number): string =>
	value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

const coordKey = (lat: number, lng: number): string =>
	`${lat.toFixed(6)},${lng.toFixed(6)}`;

const coordLabel = (lat: number, lng: number): string =>
	`${formatCoordNumber(lat)}, ${formatCoordNumber(lng)}`;

const repoScanPath = (path: string): boolean =>
	CODE_EXTENSIONS.has(path.slice(path.lastIndexOf("."))) && !isSkipped(path);

/**
 * List current snapshot files via git's index/worktree view. This reads no
 * history, includes untracked non-ignored files, and falls back to walking ".".
 */
const currentSnapshotFiles = (): readonly string[] => {
	const result = Bun.spawnSync({
		cmd: ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
		stdout: "pipe",
		stderr: "pipe",
	});
	const text =
		result.exitCode === 0 ? new TextDecoder().decode(result.stdout) : "";
	const files = text === "" ? walk(".") : text.split(/\r?\n/);
	return [...new Set(files.map((file) => file.replace(/^\.\//, "")))]
		.filter((file) => file !== "" && repoScanPath(file))
		.sort();
};

const geoGroup = ({
	lat,
	lng,
	shelter_match,
}: Pick<MarkerRow, "lat" | "lng" | "shelter_match">): string => {
	if (shelter_match !== "") return "R. demo shelter coordinate";
	if (lng >= 121.66 && lng < 121.67) return "D. 經度 121.66x 花蓮東部";
	if (lat >= 23.67 && lat < 23.68 && lng >= 121.41 && lng < 121.43)
		return "A. 光復鄉大馬村區";
	if (lat >= 23.65 && lat < 23.67 && lng >= 121.42 && lng < 121.43)
		return "B. reviewed public reference coordinate range";
	if (lat >= 23.62 && lat < 23.66 && lng >= 121.43 && lng < 121.44)
		return "C. 光復鄉南邊";
	return "Z. 其他/需回原檔確認";
};

/**
 * Render a hand-review index that is intentionally text-first: unique points are
 * grouped geographically, then every file gets a compact coordinate/source list.
 */
const renderCurrentByFile = (rows: readonly MarkerRow[]): string => {
	const byCoord = new Map<string, MarkerRow[]>();
	for (const row of rows) {
		const key = coordKey(row.lat, row.lng);
		byCoord.set(key, [...(byCoord.get(key) ?? []), row]);
	}
	const unique = [...byCoord.values()]
		.map((bucket) => ({ sample: bucket[0]!, rows: bucket }))
		.sort(
			(a, b) =>
				geoGroup(a.sample).localeCompare(geoGroup(b.sample)) ||
				a.sample.lat - b.sample.lat ||
				a.sample.lng - b.sample.lng,
		);
	const groupLines = [...new Set(unique.map(({ sample }) => geoGroup(sample)))]
		.sort()
		.flatMap((group) => [
			"",
			`### ${group}`,
			...unique
				.filter(({ sample }) => geoGroup(sample) === group)
				.map(({ sample, rows }) => {
					const files = [...new Set(rows.map((row) => row.file))].sort();
					return `- ${coordLabel(sample.lat, sample.lng)} (${rows.length} hits) — ${files.join(", ")}`;
				}),
		]);
	const byFile = new Map<string, MarkerRow[]>();
	for (const row of rows)
		byFile.set(row.file, [...(byFile.get(row.file) ?? []), row]);
	const fileLines = [...byFile.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([file, fileRows]) => {
			const coords = [
				...new Set(fileRows.map((row) => coordKey(row.lat, row.lng))),
			];
			const categories = [...new Set(fileRows.map((row) => row.category))]
				.sort()
				.join("|");
			return `- ${file}: ${fileRows.length} hits, ${coords.length} unique coords, ${categories}`;
		});
	return [
		"# Coordinate Current Snapshot By File",
		"",
		`Generated: ${new Date().toISOString()}`,
		`Rows: ${rows.length}`,
		`Unique coordinates: ${byCoord.size}`,
		"Scope: current tracked + untracked non-ignored repo files only; git history excluded.",
		"",
		"## 唯一座標 (按地理分群)",
		...groupLines,
		"",
		"## 涉及檔案",
		"",
		...fileLines,
		"",
		"Line-level context remains in markers.csv.",
		"",
	].join("\n");
};

const repoRoot = process.cwd();
const outDir =
	process.env.DOVETAIL_COORD_OUT ?? join(repoRoot, "temp", "coord-audit");

const scanFiles = currentSnapshotFiles().map((p) => relative(repoRoot, p));

const markerRows: MarkerRow[] = [];
const polygonRows: PolygonRow[] = [];

for (const file of scanFiles) {
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		continue;
	}
	markerRows.push(...extractMarkers(file, text));
	if (file.endsWith(".geojson"))
		polygonRows.push(...extractGeoJsonPolygons(file, text));
	else if (file.endsWith(".ts"))
		polygonRows.push(...extractTsPolygons(file, text));
}

const uniqueRows = aggregateUnique(markerRows);

const markersCsv = [
	csvRowOf([
		"file",
		"line",
		"lat",
		"lng",
		"category",
		"shelter_match",
		"context",
	]),
	...markerRows.map((r) =>
		csvRowOf([
			r.file,
			r.line,
			r.lat,
			r.lng,
			r.category,
			r.shelter_match,
			r.context,
		]),
	),
].join("\n");

const uniqueCsv = [
	csvRowOf([
		"lat",
		"lng",
		"source_count",
		"categories",
		"shelter_match",
		"needs_review",
		"sources",
	]),
	...uniqueRows.map((r) =>
		csvRowOf([
			r.lat,
			r.lng,
			r.source_count,
			r.categories.join("|"),
			r.shelter_match,
			r.shelter_match === "" ? "yes" : "no",
			r.sources.join(";"),
		]),
	),
].join("\n");

const polygonsCsv = [
	csvRowOf([
		"file",
		"layer",
		"vertices",
		"min_lat",
		"max_lat",
		"min_lng",
		"max_lng",
		"centroid_lat",
		"centroid_lng",
	]),
	...polygonRows.map((r) =>
		csvRowOf([
			r.file,
			r.layer,
			r.vertices,
			r.min_lat,
			r.max_lat,
			r.min_lng,
			r.max_lng,
			r.centroid_lat,
			r.centroid_lng,
		]),
	),
].join("\n");

const needsReviewCount = uniqueRows.filter(
	(r) => r.shelter_match === "",
).length;

const summary = `# Coordinate Audit

Generated: ${new Date().toISOString()}
Repo root: ${repoRoot}

## Marker totals

- raw marker hits: ${markerRows.length}
- unique lat,lng pairs: ${uniqueRows.length}
- matched DEMO_SHELTERS allowlist: ${uniqueRows.length - needsReviewCount}
- needs manual review: ${needsReviewCount}

## Marker categories

${[...new Set(markerRows.map((r) => r.category))]
	.sort()
	.map(
		(cat) =>
			`- ${cat}: ${markerRows.filter((r) => r.category === cat).length} hits`,
	)
	.join("\n")}

## Polygon layers

- polygon feature rows: ${polygonRows.length}
- files: ${[...new Set(polygonRows.map((r) => r.file))].join(", ")}

## Outputs

- markers.csv — every (file, line) lat/lng hit
- markers-unique.csv — unique (lat, lng) with sources joined; \`needs_review=yes\` for non-shelter points
- polygons.csv — bbox + centroid per polygon feature (vertex coordinates omitted for review brevity)

## Next steps

1. Open markers-unique.csv, filter \`needs_review=yes\`.
2. For each point, cross-check against authoritative public maps (避難所、學校、公所、村里活動中心、橋梁、河道) and government datasets cited in data/docs/SOURCES.md.
3. Record decisions in docs/maintainer/privacy-release-checklist.md \`Coordinate Review\` table.
4. After every \`needs_review\` point is decided, downgrade the corresponding fixture (or remove it) before any coord_resolution change ships.
`;

writeFileText(join(outDir, "markers.csv"), markersCsv);
writeFileText(join(outDir, "markers-unique.csv"), uniqueCsv);
writeFileText(join(outDir, "polygons.csv"), polygonsCsv);
writeFileText(join(outDir, "summary.md"), summary);
writeFileText(
	join(outDir, "coords-history-by-file.txt"),
	renderCurrentByFile(markerRows),
);

console.log(`marker hits     : ${markerRows.length}`);
console.log(`unique pairs    : ${uniqueRows.length}`);
console.log(`needs review    : ${needsReviewCount}`);
console.log(`polygon rows    : ${polygonRows.length}`);
console.log(`snapshot hits   : ${markerRows.length}`);
console.log(`output dir      : ${outDir}`);
