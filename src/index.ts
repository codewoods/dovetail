import {
	AGENCY_PROFILE_TABLE,
	type AgencyProfile,
	buildAgencyExport,
	COORD_RESOLUTION_TABLE,
	type CoordResolution,
	DEFAULT_COORD_RESOLUTION,
	toAgencyCsv,
} from "./analysis/agency-export.ts";
import {
	analyse,
	parsePacketBatch,
	partitionIngressPackets,
	queryHazardZone,
	type SemanticVerification,
} from "./analysis/api.ts";
import {
	createGatewayVerificationState,
	type GatewayVerificationState,
	parseGatewayMacKeyHex,
	verifyGatewayBatch,
} from "./analysis/gateway-verification.ts";
import {
	createRateLimiterState,
	rateLimit,
	sourceIdFromHeaders,
} from "./analysis/rate-limit.ts";
import { runtimeConfig } from "./config/runtime.ts";
import { demoAssets } from "./demo/assets.ts";
import {
	decodeService,
	type EncodeRequest,
	encodeService,
} from "./demo/codec-service.ts";
import { demoHtml } from "./demo/page.ts";
import { DEMO_SCENARIOS } from "./demo/scenarios.ts";
import { openApiSpec } from "./openapi.ts";
import { apiDocsHtml } from "./openapi-docs.ts";
import { MAX_PACKET_BODY_BYTES } from "./packet/validate.ts";

/**
 * Fetch handler — thin router. analysis-component is the HTTP surface;
 * codec endpoints + demo page are evaluator helpers, not part of the protocol.
 * Runtime-agnostic Web Request/Response so src/server.ts (Bun.serve) and the
 * vitest suites can exercise the same path without a cloud-runtime assumption.
 */
const fetchHandler = async (request: Request): Promise<Response> => {
	const url = new URL(request.url);
	const route = findApiRoute(request.method, url.pathname);
	if (route) return route(request, url);
	const asset = staticAssetFor(request.method, url.pathname);
	if (asset) return textResponse(asset.body, asset.contentType);
	if (url.pathname === "/" || url.pathname === "/demo") return demoResponse();
	return errorResponse("not_found", 404);
};

export default { fetch: fetchHandler };

// Ingress rate limiter state per spec §8.1.3. Module-scope so the same Bun.serve
// process tracks token-bucket usage across requests; tests reset via __resetForTests().
const ingressLimiter = createRateLimiterState();
let gatewayVerificationState = createGatewayVerificationState();
let gatewayVerificationQueue: Promise<void> = Promise.resolve();

// Test-only escape hatch: also clears the cross-batch replay key set, so a
// production caller wiping this would silently re-open the §8.1.1 replay window.
// Guard against accidental import outside the vitest/NODE_ENV=test path.
const inTestEnv = (): boolean =>
	process.env.NODE_ENV === "test" || process.env.VITEST === "true";

export const __resetForTests = (): void => {
	if (!inTestEnv())
		throw new Error(
			"__resetForTests called outside test environment; replay window protection refused to clear",
		);
	ingressLimiter.clear();
	gatewayVerificationState = createGatewayVerificationState();
	gatewayVerificationQueue = Promise.resolve();
};

/**
 * Apply spec §8.1.3 ingress rate limit; returns 429 on overflow with Retry-After.
 * `x-source-id`/`x-forwarded-for` are only consulted when DOVETAIL_TRUST_PROXY_HEADERS=1
 * (set this only behind a reverse proxy that strips/normalises those headers).
 */
const trustProxyHeaders = (): boolean =>
	process.env.DOVETAIL_TRUST_PROXY_HEADERS === "1";

const enforceRateLimit = (request: Request): Response | null => {
	const source = sourceIdFromHeaders(request.headers, {
		trustProxyHeaders: trustProxyHeaders(),
	});
	const outcome = rateLimit({
		state: ingressLimiter,
		source,
		nowMs: Date.now(),
	});
	if (outcome.allowed) return null;
	const retrySec = Math.max(1, Math.ceil(outcome.retryAfterMs / 1000));
	return jsonResponse(
		{ error: "rate_limited" },
		{ status: 429, headers: { "Retry-After": String(retrySec) } },
	);
};

export type VerificationMode = "verified" | "demo_unverified";

type ActiveGatewayKey =
	| { readonly mode: "verified"; readonly key: Uint8Array }
	| { readonly mode: "demo_unverified" }
	| { readonly mode: "demo_forbidden" }
	| { readonly mode: "missing" };

const isProductionDeployment = (): boolean =>
	process.env.DOVETAIL_DEPLOYMENT_MODE === "production";

/**
 * Resolve ingest verification mode per spec §8.0.1. Fail-closed default: when no
 * gateway key is configured and the operator did not explicitly opt into the
 * keyless demo path, downstream callers receive `missing` so HTTP ingress can
 * answer 503 instead of silently accepting unverified packets.
 */
const activeGatewayKey = (): ActiveGatewayKey => {
	const hex =
		process.env.DOVETAIL_GATEWAY_MAC_KEY_HEX ?? runtimeConfig.gatewayMacKeyHex;
	if (hex) return { mode: "verified", key: parseGatewayMacKeyHex(hex) };
	if (process.env.DOVETAIL_ALLOW_UNVERIFIED_INGEST === "1") {
		if (isProductionDeployment()) return { mode: "demo_forbidden" };
		return { mode: "demo_unverified" };
	}
	return { mode: "missing" };
};

const gatewayVerificationStatePath = (): string | undefined => {
	const path = process.env.DOVETAIL_GATEWAY_VERIFICATION_STATE_PATH?.trim();
	return path ? path : undefined;
};

/**
 * Serialize verified-mode state transitions. HMAC work is async, so without a
 * queue two concurrent requests can both verify against the same previous
 * replay/chain state before either one commits the accepted replay key.
 */
const withGatewayVerificationLock = async <T>(
	operation: () => Promise<T>,
): Promise<T> => {
	const previous = gatewayVerificationQueue;
	let release = (): void => {};
	gatewayVerificationQueue = new Promise<void>((resolve) => {
		release = resolve;
	});
	await previous.catch(() => undefined);
	try {
		return await operation();
	} finally {
		release();
	}
};

/**
 * Render a one-line operator banner so a host starting the server cannot ship
 * `demo_unverified` to production without seeing it in the boot log, and so the
 * proxy-trust toggle stays visible whenever inbound headers feed the rate limiter.
 */
export const securityPostureBanner = (): string => {
	let mode: ActiveGatewayKey["mode"];
	try {
		mode = activeGatewayKey().mode;
	} catch {
		mode = "missing";
	}
	const proxyTrust = trustProxyHeaders() ? "on" : "off";
	return `dovetail security posture: verification_mode=${mode}, proxy_trust=${proxyTrust}`;
};

type GatewayCheck =
	| { readonly rejection: Response }
	| { readonly mode: VerificationMode };

/**
 * Gate packet ingestion before analysis/export. Verified mode owns mutable
 * gateway chain state; demo mode short-circuits verification but still carries
 * the mode label so handlers can stamp the response for downstream audit.
 * Config errors return 503 `gateway_verification_not_configured`; genuine
 * verification exceptions surface as 500 `gateway_verification_error` so crypto
 * regressions are not hidden behind a "missing key" status.
 */
const enforceGatewayVerification = async (
	packets: Parameters<typeof verifyGatewayBatch>[0],
): Promise<GatewayCheck> => {
	let active: ActiveGatewayKey;
	try {
		active = activeGatewayKey();
	} catch {
		return {
			rejection: errorResponse("gateway_verification_not_configured", 503),
		};
	}
	if (active.mode === "missing")
		return {
			rejection: errorResponse("gateway_verification_not_configured", 503),
		};
	if (active.mode === "demo_forbidden")
		return {
			rejection: errorResponse(
				"demo_unverified_not_allowed_in_production",
				503,
			),
		};
	if (active.mode === "demo_unverified") return { mode: "demo_unverified" };
	try {
		return await withGatewayVerificationLock(async () => {
			const statePath = gatewayVerificationStatePath();
			const state = statePath
				? await loadGatewayVerificationState(statePath)
				: gatewayVerificationState;
			const outcome = await verifyGatewayBatch(packets, active.key, state);
			if (!outcome.ok)
				return {
					rejection: errorResponse(
						outcome.error,
						outcome.error === "replay_detected" ? 409 : 400,
					),
				};
			if (statePath)
				await saveGatewayVerificationState(statePath, outcome.state);
			gatewayVerificationState = outcome.state;
			return { mode: "verified" };
		});
	} catch {
		return {
			rejection: errorResponse("gateway_verification_error", 500),
		};
	}
};

const loadGatewayVerificationState = async (
	path: string,
): Promise<GatewayVerificationState> => {
	const { loadGatewayVerificationStateFromFile } = await import(
		"./analysis/gateway-state-file.ts"
	);
	return loadGatewayVerificationStateFromFile(path);
};

const saveGatewayVerificationState = async (
	path: string,
	state: GatewayVerificationState,
): Promise<void> => {
	const { saveGatewayVerificationStateToFile } = await import(
		"./analysis/gateway-state-file.ts"
	);
	return saveGatewayVerificationStateToFile(path, state);
};

const VERIFICATION_MODE_HEADER = "X-Dovetail-Verification-Mode";
const SEMANTIC_VERIFICATION: SemanticVerification =
	"field_observation_unverified_truth";

/**
 * Prepend a comment row carrying audit metadata to a CSV body so cross-agency
 * file transfers retain the verification signal even when only the file is
 * forwarded. Comment prefix `#` is the default skip token for pandas/DuckDB/awk;
 * callers opt in by setting `include_metadata=1` per spec §11.1.
 */
const prependCsvMetadata = (
	csv: string,
	mode: VerificationMode,
	semanticVerification: SemanticVerification,
): string => {
	const bom = "\ufeff";
	const exportedAt = new Date().toISOString();
	const meta = `# verification_mode=${mode},semantic_verification=${semanticVerification},exported_at=${exportedAt}\n`;
	const body = csv.startsWith(bom) ? csv.slice(bom.length) : csv;
	return `${bom}${meta}${body}`;
};

const oversizedByContentLength = (request: Request): boolean => {
	const value = request.headers.get("content-length");
	if (value === null) return false;
	const bytes = Number(value);
	return Number.isInteger(bytes) && bytes > MAX_PACKET_BODY_BYTES;
};

/**
 * Read request bodies with the same byte budget as JSON validation so chunked
 * uploads cannot allocate an unbounded string before `parsePacketBatch()`.
 */
const readBoundedBodyText = async (
	request: Request,
): Promise<{ ok: true; raw: string } | { ok: false; error: string }> => {
	const reader = request.body?.getReader();
	if (!reader) return { ok: true, raw: "" };
	const decoder = new TextDecoder();
	let bytes = 0;
	const chunks: string[] = [];
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				const finalChunk = decoder.decode();
				if (finalChunk) chunks.push(finalChunk);
				return { ok: true, raw: chunks.join("") };
			}
			bytes += value.byteLength;
			if (bytes > MAX_PACKET_BODY_BYTES) {
				await reader.cancel();
				return { ok: false, error: "body_too_large" };
			}
			chunks.push(decoder.decode(value, { stream: true }));
		}
	} catch {
		return { ok: false, error: "invalid_json" };
	}
};

const handlePackets = async (request: Request): Promise<Response> => {
	// Rate limit precedes the media-type check so a non-JSON flood cannot bypass
	// the 60/min budget by harvesting cheap 415 responses (security review §P0).
	const limited = enforceRateLimit(request);
	if (limited) return limited;
	if (!isJsonRequest(request))
		return errorResponse("unsupported_media_type", 415);
	if (oversizedByContentLength(request))
		return errorResponse("body_too_large", 400);
	const raw = await readBoundedBodyText(request);
	if (!raw.ok) return errorResponse(raw.error, 400);
	const parsed = parsePacketBatch(raw.raw);
	if (!parsed.ok) return errorResponse(parsed.error, 400);
	const { accepted, rejected } = await partitionIngressPackets(parsed.packets);
	const check = await enforceGatewayVerification(accepted);
	if ("rejection" in check) return check.rejection;
	const analysis = analyse(accepted);
	return jsonResponse(
		{ ...analysis, rejected, verification_mode: check.mode },
		{ headers: { [VERIFICATION_MODE_HEADER]: check.mode } },
	);
};

type ExportFormat = "json" | "csv";

type ExportRequest =
	| {
			readonly ok: true;
			readonly profile: AgencyProfile;
			readonly format: ExportFormat;
			readonly includeMetadata: boolean;
			readonly coord_resolution: CoordResolution;
	  }
	| { readonly ok: false; readonly response: Response };

/** Export coordinates can only be coarsened up to the privacy-by-default ceiling. */
const parseCoordResolution = (value: string | null): CoordResolution | null => {
	if (value === null) return DEFAULT_COORD_RESOLUTION;
	if (!/^[0-4]$/.test(value)) return null;
	const parsed = Number(value) as CoordResolution;
	return COORD_RESOLUTION_TABLE.includes(parsed) ? parsed : null;
};

type ExportProfileAllowlist =
	| { readonly ok: true; readonly profiles: readonly AgencyProfile[] | null }
	| { readonly ok: false; readonly response: Response };

/** Parse the deployment export allowlist once per request so profile access fails before body parsing. */
const exportProfileAllowlist = (): ExportProfileAllowlist => {
	const raw = process.env.DOVETAIL_EXPORT_PROFILES;
	if (raw === undefined || raw.trim() === "") {
		return isProductionDeployment()
			? {
					ok: false,
					response: errorResponse(
						"export_profile_allowlist_not_configured",
						503,
					),
				}
			: { ok: true, profiles: null };
	}
	const profiles = raw.split(",").map((item) => parseProfile(item.trim()));
	if (profiles.length === 0 || profiles.some((profile) => profile === null))
		return {
			ok: false,
			response: errorResponse("invalid_export_profile_allowlist", 503),
		};
	return { ok: true, profiles: [...new Set(profiles as AgencyProfile[])] };
};

const exportProfileAllowed = (profile: AgencyProfile): Response | null => {
	const allowlist = exportProfileAllowlist();
	if (!allowlist.ok) return allowlist.response;
	if (allowlist.profiles === null) return null;
	return allowlist.profiles.includes(profile)
		? null
		: errorResponse("export_profile_not_allowed", 403);
};

/** Validate export query knobs before body parsing so invalid requests do not reach analysis. */
const parseExportRequest = (request: Request, url: URL): ExportRequest => {
	const limited = enforceRateLimit(request);
	if (limited) return { ok: false, response: limited };
	if (!isJsonRequest(request))
		return {
			ok: false,
			response: errorResponse("unsupported_media_type", 415),
		};
	const profile = parseProfile(url.searchParams.get("profile"));
	if (!profile)
		return {
			ok: false,
			response: errorResponse("invalid_export_profile", 400),
		};
	const profileDenied = exportProfileAllowed(profile);
	if (profileDenied) return { ok: false, response: profileDenied };
	const format = url.searchParams.get("format") ?? "json";
	if (format !== "json" && format !== "csv")
		return { ok: false, response: errorResponse("invalid_export_format", 400) };
	const coord_resolution = parseCoordResolution(
		url.searchParams.get("coord_resolution"),
	);
	if (coord_resolution === null)
		return {
			ok: false,
			response: errorResponse("invalid_coord_resolution", 400),
		};
	if (oversizedByContentLength(request))
		return { ok: false, response: errorResponse("body_too_large", 400) };
	return {
		ok: true,
		profile,
		format,
		includeMetadata: url.searchParams.get("include_metadata") === "1",
		coord_resolution,
	};
};

interface ExportResponseInput {
	readonly exportData: ReturnType<typeof buildAgencyExport>;
	readonly rejected: Awaited<
		ReturnType<typeof partitionIngressPackets>
	>["rejected"];
	readonly mode: VerificationMode;
	readonly format: ExportFormat;
	readonly includeMetadata: boolean;
}

const exportResponse = ({
	exportData,
	rejected,
	mode,
	format,
	includeMetadata,
}: ExportResponseInput): Response => {
	const modeHeaders = { [VERIFICATION_MODE_HEADER]: mode };
	if (format === "csv") {
		const csv = toAgencyCsv(exportData);
		const body = includeMetadata
			? prependCsvMetadata(
					csv,
					mode,
					exportData.semantic_verification ?? SEMANTIC_VERIFICATION,
				)
			: csv;
		return textResponse(body, "text/csv; charset=utf-8", modeHeaders);
	}
	return jsonResponse(
		{ ...exportData, rejected, verification_mode: mode },
		{ headers: modeHeaders },
	);
};

/**
 * Export requests share packet validation with /api/packets, then apply only the
 * agency profile/format projection so CSV and JSON cannot drift semantically.
 * `verification_mode` is mirrored as a response header for every format so
 * cross-agency file transfers retain the audit signal (spec §8.0.1 / §11.1).
 */
const handlePacketExport = async (
	request: Request,
	url: URL,
): Promise<Response> => {
	const exportRequest = parseExportRequest(request, url);
	if (!exportRequest.ok) return exportRequest.response;
	const raw = await readBoundedBodyText(request);
	if (!raw.ok) return errorResponse(raw.error, 400);
	const parsed = parsePacketBatch(raw.raw);
	if (!parsed.ok) return errorResponse(parsed.error, 400);
	const { accepted, rejected } = await partitionIngressPackets(parsed.packets);
	const check = await enforceGatewayVerification(accepted);
	if ("rejection" in check) return check.rejection;
	return exportResponse({
		exportData: buildAgencyExport(analyse(accepted), exportRequest.profile, {
			coord_resolution: exportRequest.coord_resolution,
		}),
		rejected,
		mode: check.mode,
		format: exportRequest.format,
		includeMetadata: exportRequest.includeMetadata,
	});
};

/** Hazard-zone lookup validates numeric coordinates before touching static hazard data. */
const handleHazardZone = (url: URL): Response => {
	const lat = Number(url.searchParams.get("lat"));
	const lng = Number(url.searchParams.get("lng"));
	const result = queryHazardZone({ lat, lng });
	if (!result) return errorResponse("invalid_lat_lng", 400);
	return jsonResponse(result);
};

/**
 * Parse codec helper JSON behind the same body-size budget and rate-limit gate as
 * `/api/packets` so the demo endpoints cannot be turned into a memory/DoS amplifier.
 */
const readCodecJsonBody = async <T>(
	request: Request,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> => {
	const limited = enforceRateLimit(request);
	if (limited) return { ok: false, response: limited };
	if (!isJsonRequest(request))
		return {
			ok: false,
			response: errorResponse("unsupported_media_type", 415),
		};
	if (oversizedByContentLength(request))
		return { ok: false, response: errorResponse("body_too_large", 400) };
	const raw = await readBoundedBodyText(request);
	if (!raw.ok) return { ok: false, response: errorResponse(raw.error, 400) };
	try {
		return { ok: true, value: JSON.parse(raw.raw) as T };
	} catch {
		return { ok: false, response: errorResponse("invalid_json", 400) };
	}
};

// Internal codec errors are logged server-side but never reflected to clients so
// AES-GCM / parser strings cannot leak through the demo helper boundary.
const handleCodecHelper = async <T>(
	request: Request,
	run: (body: T) => Promise<Response>,
): Promise<Response> => {
	const parsed = await readCodecJsonBody<T>(request);
	if (!parsed.ok) return parsed.response;
	try {
		return await run(parsed.value);
	} catch {
		return errorResponse("codec_error", 400);
	}
};

const handleEncode = (request: Request): Promise<Response> =>
	handleCodecHelper<unknown>(request, async (body) =>
		isEncodeRequestBody(body)
			? jsonResponse(await encodeService(body))
			: errorResponse("invalid_codec_request", 400),
	);

const isEncodeRequestBody = (body: unknown): body is EncodeRequest =>
	body !== null &&
	typeof body === "object" &&
	Object.keys(body).length === 1 &&
	"packet" in body;

const handleDecode = (request: Request): Promise<Response> =>
	handleCodecHelper<{ hex: string; counter: number; mac: string }>(
		request,
		async (body) => {
			const macBytes = Uint8Array.from(
				body.mac.replace(/[^0-9a-fA-F]/g, "").match(/.{2}/g) ?? [],
				(b) => parseInt(b, 16),
			);
			return jsonResponse(
				await decodeService({ hex: body.hex, counter: body.counter }, macBytes),
			);
		},
	);

/** Content-type checks stay permissive for charset suffixes sent by browsers. */
const isJsonRequest = (request: Request): boolean => {
	const contentType = request.headers.get("content-type");
	return contentType?.toLowerCase().includes("application/json") ?? false;
};

const securityHeaders = {
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
	"Permissions-Policy": "geolocation=(), microphone=(), camera=()",
	"Cross-Origin-Resource-Policy": "same-origin",
} as const;

/** JSON responses always opt out of caches because packets may contain PII. */
const jsonResponse = (body: unknown, init: ResponseInit = {}): Response => {
	return Response.json(body, {
		...init,
		headers: {
			...securityHeaders,
			"Cache-Control": "no-store",
			...init.headers,
		},
	});
};

const textResponse = (
	body: string,
	contentType: string,
	extraHeaders: Readonly<Record<string, string>> = {},
): Response =>
	new Response(body, {
		headers: {
			...securityHeaders,
			"Cache-Control": "no-store",
			"Content-Type": contentType,
			...extraHeaders,
		},
	});

const errorResponse = (error: string, status: number): Response =>
	jsonResponse({ error }, { status });

/**
 * Scalar is loaded from the vendored same-origin bundle, while the contract
 * stays at /api/openapi.json so the docs page never embeds runtime secrets.
 */
const apiDocsResponse = (): Response =>
	new Response(apiDocsHtml, {
		headers: {
			...securityHeaders,
			"Cache-Control": "no-store",
			"Content-Type": "text/html; charset=utf-8",
			"Content-Security-Policy":
				"default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
		},
	});

type RouteHandler = (
	request: Request,
	url: URL,
) => Response | Promise<Response>;
type DemoAsset = (typeof demoAssets)[keyof typeof demoAssets];

const routeKey = (method: string, pathname: string): string =>
	`${method} ${pathname}`;

const apiRouteEntries: readonly (readonly [string, RouteHandler])[] = [
	["POST /api/packets", (request) => handlePackets(request)],
	[
		"POST /api/packets/export",
		(request, url) => handlePacketExport(request, url),
	],
	["GET /api/hazard-zone", (_request, url) => handleHazardZone(url)],
	["POST /api/codec/encode", (request) => handleEncode(request)],
	["POST /api/codec/decode", (request) => handleDecode(request)],
	["GET /api/scenarios", () => jsonResponse(DEMO_SCENARIOS)],
	["GET /api/openapi.json", () => jsonResponse(openApiSpec)],
	["GET /api/docs", () => apiDocsResponse()],
];

const apiRoutes: ReadonlyMap<string, RouteHandler> = new Map(apiRouteEntries);

const findApiRoute = (
	method: string,
	pathname: string,
): RouteHandler | undefined => {
	const key = routeKey(method, pathname);
	return apiRoutes.get(key);
};

const staticAssetFor = (method: string, pathname: string): DemoAsset | null => {
	if (method !== "GET") return null;
	return demoAssets[pathname as keyof typeof demoAssets] ?? null;
};

/** Export profiles are intentionally closed so unknown agency views fail fast. */
const parseProfile = (value: string | null): AgencyProfile | null => {
	if (!value) return null;
	return (AGENCY_PROFILE_TABLE as readonly string[]).includes(value)
		? (value as AgencyProfile)
		: null;
};

/**
 * Build the /demo response with same-origin CSS and JS assets so CSP can stay on
 * plain 'self' for both styles and scripts while the HTML shell remains
 * server-rendered and deterministic for the offline demo flow.
 */
const demoResponse = (): Response => {
	return new Response(demoHtml, {
		headers: {
			...securityHeaders,
			"Content-Type": "text/html; charset=utf-8",
			"Content-Security-Policy":
				"default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
		},
	});
};
