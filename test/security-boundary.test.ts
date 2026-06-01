import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_SCENARIOS } from "../src/demo/scenarios.ts";
import worker from "../src/index.ts";
import {
	MAX_PACKET_BATCH,
	MAX_PACKET_BODY_BYTES,
	validatePacketBatch,
} from "../src/packet/validate.ts";

const PUBLIC_PACKET_FIXTURE_PATHS = [
	"examples/packets-batch.json",
	"api/bruno/core/02-packets.yml",
	"api/bruno/core/03-packets-export.yml",
	"api/bruno/demo/02-encode.yml",
] as const;

const PUBLIC_COORDINATE_FIXTURE_PATHS = [
	...PUBLIC_PACKET_FIXTURE_PATHS,
	"api/bruno/core/04-hazard-zone.yml",
] as const;

const PUBLIC_FIXTURE_COORDINATES = [
	"23.661234,121.421789",
	"23.641234,121.395678",
	"23.674322,121.424416",
] as const;

const SENSITIVE_DEMO_LABEL_PATTERN =
	/"(?:special_needs|long_term_care|migrant_worker|foreign_visitor|requires_separated_space|consent_refused|WORKSITE|ARTIST_RESIDENCY)"/;

const COORDINATE_PAIR_PATTERNS = [
	/"lat": ([\d.]+),\s*"lng": ([\d.]+)/g,
	/[?&]lat=([\d.]+)&lng=([\d.]+)/g,
	/input\.lat\)\.to\.equal\(([\d.]+)\);\s*expect\(body\.input\.lng\)\.to\.equal\(([\d.]+)\)/g,
] as const;

/**
 * Public fixtures encode coordinates as packet JSON, Bruno URLs, or Bruno test
 * assertions. Extracting all three shapes lets one allowlist gate cover every
 * public coordinate surface instead of maintaining retired-coordinate patterns.
 */
const extractFixtureCoordinates = (text: string): readonly string[] =>
	COORDINATE_PAIR_PATTERNS.flatMap((pattern) =>
		[...text.matchAll(pattern)].map((match) => `${match[1]},${match[2]}`),
	);

const postPackets = (
	body: unknown,
	headers: Record<string, string> = { "content-type": "application/json" },
): Promise<Response> => {
	const packetBody = JSON.stringify(body);
	return worker.fetch(
		new Request("https://example.org/api/packets", {
			method: "POST",
			headers,
			body: packetBody,
		}),
	);
};

describe("security boundary", () => {
	it("rejects malformed packet JSON before analysis", async () => {
		const response = await postPackets([
			{ type: "person_report", packet: { count: 1 } },
		]);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "invalid_packet_schema" });
	});

	it("rejects oversized packet batches and request bodies", async () => {
		const manyPackets = Array.from(
			{ length: MAX_PACKET_BATCH + 1 },
			() => DEMO_SCENARIOS[0]!.packets[0]!,
		);
		expect(validatePacketBatch(manyPackets)).toEqual({
			ok: false,
			error: "batch_too_large",
		});

		const oversizedBody = JSON.stringify(["x".repeat(MAX_PACKET_BODY_BYTES)]);
		const response = await worker.fetch(
			new Request("https://example.org/api/packets", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: oversizedBody,
			}),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "body_too_large" });
	});

	it("rejects oversized content-length before parsing packet JSON", async () => {
		const response = await worker.fetch(
			new Request("https://example.org/api/packets", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"content-length": String(MAX_PACKET_BODY_BYTES + 1),
				},
				body: "[]",
			}),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "body_too_large" });
	});

	it("stops reading streaming bodies once the packet body budget is exceeded", async () => {
		let pullCount = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull: (controller) => {
				pullCount += 1;
				if (pullCount === 1) {
					controller.enqueue(new Uint8Array(MAX_PACKET_BODY_BYTES + 1));
					return;
				}
				controller.error(new Error("read past body budget"));
			},
		});
		const requestInit = {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: stream,
			duplex: "half",
		} as RequestInit & { duplex: "half" };
		const response = await worker.fetch(
			new Request("https://example.org/api/packets", requestInit),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "body_too_large" });
		expect(pullCount).toBe(1);
	});

	it("requires JSON media type and emits defensive response headers", async () => {
		const response = await postPackets(DEMO_SCENARIOS[0]!.packets, {
			"content-type": "text/plain",
		});
		const contentTypeOptions = response.headers.get("x-content-type-options");
		const cacheControl = response.headers.get("cache-control");
		expect(response.status).toBe(415);
		expect(contentTypeOptions).toBe("nosniff");
		expect(cacheControl).toBe("no-store");
	});

	it("accepts the documented integration example", () => {
		const rawExample = readFileSync("examples/packets-batch.json", "utf8");
		const example = JSON.parse(rawExample) as unknown;
		expect(validatePacketBatch(example).ok).toBe(true);
	});

	/** Public fixtures are copied by integrators, so they must expose synthetic provenance and avoid sensitive labels. */
	it("keeps public packet fixtures synthetic-labeled and aggregate-safe", () => {
		for (const path of PUBLIC_PACKET_FIXTURE_PATHS) {
			const text = readFileSync(path, "utf8");

			expect(text).toContain("MOCK-HUA-GFG-001");
			expect(text).not.toMatch(SENSITIVE_DEMO_LABEL_PATTERN);
		}
	});

	it("keeps public coordinate fixtures on reviewed public reference pairs", () => {
		const allowed = new Set<string>(PUBLIC_FIXTURE_COORDINATES);
		for (const path of PUBLIC_COORDINATE_FIXTURE_PATHS) {
			const text = readFileSync(path, "utf8");
			const coordinates = extractFixtureCoordinates(text);

			expect(coordinates.length).toBeGreaterThan(0);
			expect(coordinates.every((coordinate) => allowed.has(coordinate))).toBe(
				true,
			);
		}
	});

	/** The prose spec can list protocol enums, but its JSON sample must remain aggregate-safe and synthetic-labeled. */
	it("keeps the packet spec example aggregate-safe and synthetic-labeled", () => {
		const spec = readFileSync("SPEC.md", "utf8");

		expect(spec).toContain("MOCK-HUA-GFG-001");
		expect(spec).not.toContain(
			'"flags": ["special_needs", "long_term_care", "on_site"]',
		);
	});

	it("rejects envelopes whose chain_mac is not 64 hex chars (spec §8.1.2)", async () => {
		const seed = DEMO_SCENARIOS[0]!.packets[0]!;
		const forged = {
			...seed,
			envelope: { ...seed.envelope, chain_mac: "deadbeef" },
		};
		const response = await postPackets([forged]);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "invalid_packet_schema" });
	});

	it("serves the demo with clickjacking and script boundary headers", async () => {
		const response = await worker.fetch(
			new Request("https://example.org/demo"),
		);
		const csp = response.headers.get("content-security-policy") ?? "";
		const permissionsPolicy = response.headers.get("permissions-policy");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(permissionsPolicy).toContain("geolocation=()");
		expect(csp).toContain("style-src 'self'");
		expect(csp).not.toContain("style-src 'unsafe-inline'");
		expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
		expect(csp).toContain("script-src 'self'");
		expect(csp).not.toContain("'nonce-");
		const body = await response.text();
		expect(body).toContain('<link rel="stylesheet" href="/demo.css">');
		expect(body).not.toContain("<style>");
		expect(body).toContain("Web demo 使用 AES-128-GCM");
		expect(body).toContain("硬體 device profile 可採 AES-128-CCM");
		expect(body).toContain('<script id="demo-labels" type="application/json">');
		expect(body).toContain(
			'<script id="demo-hazard-zones" type="application/json">',
		);
		expect(body).toContain('id="hazard-toggle"');
		expect(body).toContain('id="hazard-opacity"');
		expect(body).toContain('id="hazard-map-svg"');
		expect(body).toContain("Hazard 圖例");
		expect(body).toContain("資料來源：農業部土石流 / 大規模崩塌潛勢圖");
		expect(body).toContain("政府資料開放授權 1.0");
		expect(body).not.toContain("堰塞湖");
		expect(body).toContain("觸發條件見 SPEC.md");
		expect(body).toContain('<script type="module" src="/demo.js"></script>');
		expect(body).not.toContain('<script type="module" nonce=');
	});

	it("serves demo.css as a same-origin stylesheet asset", async () => {
		const response = await worker.fetch(
			new Request("https://example.org/demo.css"),
		);
		const css = await response.text();
		const contentType = response.headers.get("content-type");
		expect(response.status).toBe(200);
		expect(contentType).toContain("text/css");
		expect(css).toContain(":root");
		expect(css).toContain("--bg: #f6f7f9;");
		expect(css).toContain(".hazard-map");
		expect(css).toContain(".map-point.in-zone");
		expect(css).toContain(".hazard-legend");
		expect(css).toContain(".legend-swatch");
	});

	it("serves demo.js as a same-origin module asset", async () => {
		const response = await worker.fetch(
			new Request("https://example.org/demo.js"),
		);
		const js = await response.text();
		const contentType = response.headers.get("content-type");
		expect(response.status).toBe(200);
		expect(contentType).toContain("javascript");
		expect(js).toContain("const readJsonScript = (id) =>");
		expect(js).toContain('from "/demo-render.js"');
		expect(js).toContain(
			'const LABELS_BY_LOCALE = readJsonScript("demo-labels");',
		);
		expect(js).toContain(
			'const HAZARD_ZONES = readJsonScript("demo-hazard-zones");',
		);
		expect(js).toContain('from "/hazard-map.js"');
		expect(js).toContain("const textElement =");
		expect(js).toContain("const fetchJson = async");
		expect(js).toContain("request body encode failed");
	});

	it("serves demo.js with receiver send error rendering", async () => {
		const response = await worker.fetch(
			new Request("https://example.org/demo.js"),
		);
		const js = await response.text();
		expect(response.status).toBe(200);
		expect(js).toContain("renderSendError");
		expect(js).toContain("send_error");
		expect(js).toContain("#analysis-output");
	});

	it("rejects client-supplied codec encode counters", async () => {
		const packet = DEMO_SCENARIOS[0]!.packets[0]!;
		const response = await worker.fetch(
			new Request("https://example.org/api/codec/encode", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ packet, counter: 1 }),
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "invalid_codec_request" });
	});

	it("keeps ingress body-size checks tied to the shared packet budget", async () => {
		const response = await worker.fetch(new Request("https://example.org/src"));
		expect(response.status).toBe(404);
		const source = readFileSync("src/index.ts", "utf8");
		expect(source).toContain("MAX_PACKET_BODY_BYTES");
		expect(source).not.toContain("bytes > 64 * 1024");
	});

	it("collects streaming request chunks without repeated raw string concatenation", () => {
		const source = readFileSync("src/index.ts", "utf8");

		expect(source).toContain("const chunks: string[] = []");
		expect(source).toContain('chunks.join("")');
		expect(source).not.toContain("raw +=");
	});

	it("serves split demo render helpers as a same-origin module asset", async () => {
		const response = await worker.fetch(
			new Request("https://example.org/demo-render.js"),
		);
		const js = await response.text();
		const contentType = response.headers.get("content-type");
		expect(response.status).toBe(200);
		expect(contentType).toContain("javascript");
		expect(js).toContain("export const makeAlert =");
		expect(js).toContain("export const renderCentralView =");
		expect(js).toContain("semantic_verification");
		expect(js).toContain("Field observation");
	});

	it("serves split hazard map helpers as a same-origin module asset", async () => {
		const response = await worker.fetch(
			new Request("https://example.org/hazard-map.js"),
		);
		const js = await response.text();
		const contentType = response.headers.get("content-type");
		expect(response.status).toBe(200);
		expect(contentType).toContain("javascript");
		expect(js).toContain("export const renderHazardMap =");
		expect(js).toContain("export const initLegend =");
		expect(js).toContain("zone.inZone");
	});
});
