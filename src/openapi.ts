/**
 * OpenAPI 3.1 spec for the analysis-component API.
 * Required by 簡章 §七(二) 9 for API-type components.
 */
import {
	AGENCY_PROFILE_TABLE,
	DEFAULT_COORD_RESOLUTION,
} from "./analysis/agency-export.ts";
import {
	PERSON_FLAG_TABLE,
	PERSON_STATUS_TABLE,
	RESOURCE_FLAG_TABLE,
	RESOURCE_KIND_TABLE,
	TERRAIN_EVENT_TABLE,
	TERRAIN_FLAG_TABLE,
} from "./packet/types.ts";
import { MAX_PACKET_BATCH } from "./packet/validate.ts";

export const openApiSpec = {
	openapi: "3.1.0",
	info: {
		title: "DOVETAIL - 分析元件",
		version: "0.1.0",
		description: "離網災情通報協議的分析元件 API",
	},
	servers: [{ url: "/" }],
	paths: {
		"/api/packets": {
			post: {
				summary: "批次提交解密後 packet JSON, 取得聚合分析",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/PacketBatch" },
						},
					},
				},
				responses: {
					"200": {
						description: "分析結果",
						content: {
							"application/json": {
								schema: {
									$ref: "#/components/schemas/IngressAnalysisResult",
								},
							},
						},
					},
					"400": { description: "輸入格式錯誤" },
					"409": {
						description:
							"Production gateway verification mode detected a cross-batch replay.",
					},
					"415": { description: "Content-Type 必須是 application/json" },
					"429": {
						description:
							"超過 §8.1.3 ingress rate limit (60 req/min/source)；回應含 Retry-After。",
					},
					"503": {
						description:
							"No server-side gateway MAC key is configured and DOVETAIL_ALLOW_UNVERIFIED_INGEST is not set to '1' (spec §8.0.1 fail-closed default).",
					},
				},
			},
		},
		"/api/packets/export": {
			post: {
				summary: "Build agency-specific export slices from packet JSON",
				parameters: [
					{
						name: "profile",
						in: "query",
						required: true,
						schema: {
							type: "string",
							enum: AGENCY_PROFILE_TABLE,
						},
					},
					{
						name: "format",
						in: "query",
						required: false,
						schema: { type: "string", enum: ["json", "csv"], default: "json" },
					},
					{
						name: "include_metadata",
						in: "query",
						required: false,
						schema: { type: "string", enum: ["1"] },
						description:
							"When set to `1` with `format=csv`, prepends `# verification_mode=...,semantic_verification=...,exported_at=...` as the first row so cross-agency file transfers carry the audit signal (spec §11.1). Default CSV header is unchanged.",
					},
					{
						name: "coord_resolution",
						in: "query",
						required: false,
						schema: {
							type: "integer",
							enum: [0, 1, 2, 3, 4],
							default: DEFAULT_COORD_RESOLUTION,
						},
						description:
							"Maximum decimal places for agency-export JSON event queue centroids. Default is 2; higher precision requires an explicitly allowlisted export profile in deployment.",
					},
				],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/PacketBatch" },
						},
					},
				},
				responses: {
					"200": {
						description:
							"Agency-shaped export. Profiles are static data slices, not authorization.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/AgencyExport" },
							},
							"text/csv": { schema: { type: "string" } },
						},
					},
					"400": { description: "Profile, format, or packet input is invalid" },
					"409": {
						description:
							"Production gateway verification mode detected a cross-batch replay.",
					},
					"415": { description: "Content-Type 必須是 application/json" },
					"429": {
						description:
							"超過 §8.1.3 ingress rate limit (60 req/min/source)；回應含 Retry-After。",
					},
					"503": {
						description:
							"Gateway verification is unavailable, demo verification is forbidden in production, or production export profile allowlist is not configured.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/ErrorResponse" },
							},
						},
					},
					"403": {
						description:
							"The requested profile is outside DOVETAIL_EXPORT_PROFILES.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/ErrorResponse" },
							},
						},
					},
				},
			},
		},
		"/api/hazard-zone": {
			get: {
				summary: "靜態危險區查詢 (point-in-polygon over GDAL pipeline output)",
				parameters: [
					{
						name: "lat",
						in: "query",
						required: true,
						schema: { type: "number" },
					},
					{
						name: "lng",
						in: "query",
						required: true,
						schema: { type: "number" },
					},
				],
				responses: {
					"200": { description: "查詢結果" },
					"400": { description: "lat / lng 缺失或無效" },
				},
			},
		},
		"/api/codec/encode": {
			post: {
				summary:
					"Demo helper: AEAD-encode a packet JSON into the wire frame hex (evaluator only).",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/EncodeRequest" },
						},
					},
				},
				responses: {
					"200": {
						description: "Encoded wire frame.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/EncodeResponse" },
							},
						},
					},
					"400": {
						description: "Malformed JSON, bad packet fields, or AEAD error.",
					},
					"415": { description: "Content-Type 必須是 application/json" },
				},
			},
		},
		"/api/codec/decode": {
			post: {
				summary:
					"Demo helper: AEAD-decode a wire frame hex back into packet JSON (evaluator only).",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/DecodeRequest" },
						},
					},
				},
				responses: {
					"200": {
						description: "Decoded packet JSON with verified=true.",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/DecodeResponse" },
							},
						},
					},
					"400": {
						description: "Malformed hex, wrong MAC, or AEAD verify failure.",
					},
					"415": { description: "Content-Type 必須是 application/json" },
				},
			},
		},
		"/api/scenarios": {
			get: {
				summary:
					"List demo scenarios (preset packet sequences for evaluator drop-down).",
				responses: {
					"200": {
						description: "Array of DemoScenario.",
						content: {
							"application/json": {
								schema: {
									type: "array",
									items: { $ref: "#/components/schemas/DemoScenario" },
								},
							},
						},
					},
				},
			},
		},
		"/api/openapi.json": {
			get: {
				summary: "本 spec 自身 (OpenAPI 3.1 JSON)",
				responses: { "200": { description: "OpenAPI 3.1 JSON" } },
			},
		},
		"/api/docs": {
			get: {
				summary: "Scalar HTML API reference for the OpenAPI JSON contract",
				responses: {
					"200": {
						description: "Scalar HTML API reference",
						content: { "text/html": { schema: { type: "string" } } },
					},
				},
			},
		},
	},
	components: {
		schemas: {
			PacketBatch: {
				type: "array",
				maxItems: MAX_PACKET_BATCH,
				items: { $ref: "#/components/schemas/PacketJson" },
			},
			PacketJson: {
				oneOf: [
					{ $ref: "#/components/schemas/PersonReport" },
					{ $ref: "#/components/schemas/TerrainEvent" },
					{ $ref: "#/components/schemas/ResourceReport" },
				],
			},
			Envelope: {
				type: "object",
				required: ["received_at", "gateway_id", "aead_profile", "chain_mac"],
				properties: {
					received_at: { type: "string", format: "date-time", maxLength: 40 },
					gateway_id: { type: "string", minLength: 1, maxLength: 64 },
					aead_profile: {
						type: "string",
						enum: ["aead-gcm-128", "aead-ccm-128"],
						description:
							"32-bit constrained AEAD tag profile for low-bandwidth packets. Not a general-purpose high-assurance network profile; production deployments should evaluate larger tags when the byte budget allows.",
					},
					chain_mac: {
						type: "string",
						pattern: "^[0-9a-fA-F]{64}$",
						description:
							"HMAC-SHA-256 hex (32 bytes) over canonical length-framed gateway inputs. Timestamp and replay rejection happen before gateway state advances.",
					},
				},
			},
			PersonReport: {
				type: "object",
				required: ["type", "envelope", "packet"],
				properties: {
					type: { const: "person_report" },
					envelope: { $ref: "#/components/schemas/Envelope" },
					packet: {
						type: "object",
						required: [
							"mac",
							"village",
							"ts",
							"lat",
							"lng",
							"alt",
							"addr",
							"count",
							"status",
							"flags",
						],
						properties: {
							mac: { type: "string", pattern: "^[0-9a-fA-F]{12}$" },
							village: { type: "integer", minimum: 0, maximum: 0xffffffff },
							ts: { type: "integer", minimum: 0, maximum: 0xffffffff },
							lat: { type: "number", minimum: -90, maximum: 90 },
							lng: { type: "number", minimum: -180, maximum: 180 },
							alt: { type: "integer", minimum: -500, maximum: 9000 },
							addr: { type: "string", minLength: 1, maxLength: 64 },
							count: { type: "integer", minimum: 0, maximum: 255 },
							status: {
								type: "string",
								enum: PERSON_STATUS_TABLE,
							},
							flags: {
								type: "array",
								description:
									"Person support flags. special_needs is an umbrella evacuation-support signal for people needing extra sheltering, welfare, or continuity checks; the packet does not expose child, maternity, caregiver-absence, disability, or diagnosis subcategories.",
								maxItems: PERSON_FLAG_TABLE.length,
								items: { type: "string", enum: PERSON_FLAG_TABLE },
							},
						},
					},
				},
			},
			TerrainEvent: {
				type: "object",
				required: ["type", "envelope", "packet"],
				properties: {
					type: { const: "terrain_event" },
					envelope: { $ref: "#/components/schemas/Envelope" },
					packet: {
						type: "object",
						required: [
							"mac",
							"ts",
							"lat",
							"lng",
							"event",
							"extent_m",
							"severity",
							"flags",
						],
						properties: {
							mac: { type: "string", pattern: "^[0-9a-fA-F]{12}$" },
							ts: { type: "integer", minimum: 0, maximum: 0xffffffff },
							lat: { type: "number", minimum: -90, maximum: 90 },
							lng: { type: "number", minimum: -180, maximum: 180 },
							event: {
								type: "string",
								enum: TERRAIN_EVENT_TABLE,
							},
							extent_m: { type: "integer", minimum: 0, maximum: 0xffff },
							severity: { type: "integer", minimum: 0, maximum: 255 },
							flags: {
								type: "array",
								maxItems: TERRAIN_FLAG_TABLE.length,
								items: {
									type: "string",
									enum: TERRAIN_FLAG_TABLE,
								},
							},
						},
					},
				},
			},
			ResourceReport: {
				type: "object",
				required: ["type", "envelope", "packet"],
				properties: {
					type: { const: "resource_report" },
					envelope: { $ref: "#/components/schemas/Envelope" },
					packet: {
						type: "object",
						required: [
							"mac",
							"ts",
							"lat",
							"lng",
							"addr",
							"resource",
							"quantity",
							"duration",
							"flags",
						],
						properties: {
							mac: { type: "string", pattern: "^[0-9a-fA-F]{12}$" },
							ts: { type: "integer", minimum: 0, maximum: 0xffffffff },
							lat: { type: "number", minimum: -90, maximum: 90 },
							lng: { type: "number", minimum: -180, maximum: 180 },
							addr: { type: "string", minLength: 1, maxLength: 64 },
							resource: {
								type: "array",
								maxItems: RESOURCE_KIND_TABLE.length,
								items: {
									type: "string",
									enum: RESOURCE_KIND_TABLE,
								},
							},
							quantity: { type: "integer", minimum: 0, maximum: 255 },
							duration: { type: "integer", minimum: 0, maximum: 255 },
							flags: {
								type: "array",
								maxItems: RESOURCE_FLAG_TABLE.length,
								items: { type: "string", enum: RESOURCE_FLAG_TABLE },
							},
						},
					},
				},
			},
			AnalysisResult: {
				type: "object",
				required: [
					"summary",
					"overlays",
					"alerts",
					"event_queue",
					"semantic_verification",
					"analysed_at",
				],
				properties: {
					summary: { type: "object" },
					overlays: {
						type: "array",
						items: { $ref: "#/components/schemas/PacketOverlay" },
					},
					alerts: {
						type: "array",
						description:
							"Deterministic fact triggers, not response recommendations.",
					},
					event_queue: { $ref: "#/components/schemas/EventQueue" },
					semantic_verification: {
						$ref: "#/components/schemas/SemanticVerification",
					},
					analysed_at: { type: "string", format: "date-time" },
				},
			},
			IngressAnalysisResult: {
				allOf: [
					{ $ref: "#/components/schemas/AnalysisResult" },
					{
						type: "object",
						required: ["rejected", "verification_mode"],
						properties: {
							rejected: {
								type: "array",
								description:
									"Replay-rejection log per spec §8.1.1 (duplicate hashed replay key / timestamp out of window). Only present on /api/packets ingress responses.",
								items: {
									type: "object",
									required: ["index", "replay_key", "reason"],
									properties: {
										index: { type: "integer", minimum: 0 },
										replay_key: { type: "string" },
										reason: {
											type: "string",
											enum: ["duplicate_replay_key", "timestamp_out_of_window"],
										},
									},
								},
							},
							verification_mode: {
								$ref: "#/components/schemas/VerificationMode",
							},
						},
					},
				],
			},
			VerificationMode: {
				type: "string",
				enum: ["verified", "demo_unverified"],
				description:
					"Spec §8.0.1 ingest mode. `verified`: chain_mac + replay verified against `DOVETAIL_GATEWAY_MAC_KEY_HEX`. `demo_unverified`: key missing with `DOVETAIL_ALLOW_UNVERIFIED_INGEST=1`. `X-Dovetail-Verification-Mode` carries audit mode on 200 ingest/export responses.",
			},
			SemanticVerification: {
				type: "string",
				enum: ["field_observation_unverified_truth"],
				description:
					"Signals that packet content is a field observation and not proof that the incident is factually true; human reconciliation is still required.",
			},
			PacketOverlay: {
				type: "object",
				required: ["index", "type", "lat", "lng", "ts", "zone"],
				properties: {
					index: { type: "integer", minimum: 0 },
					type: {
						type: "string",
						enum: ["person_report", "terrain_event", "resource_report"],
					},
					lat: { type: "number", minimum: -90, maximum: 90 },
					lng: { type: "number", minimum: -180, maximum: 180 },
					ts: { type: "integer", minimum: 0 },
					zone: { type: "object" },
					admin2: { type: "string" },
					osm_tags_proposed: {
						type: "string",
						description:
							"Semicolon-separated proposed OSM-style key=value hints for mapper review. Present only on mapped terrain observations.",
					},
				},
			},
			EventQueue: {
				type: "object",
				required: ["totalPackets", "groups", "hints"],
				properties: {
					totalPackets: { type: "integer", minimum: 0 },
					groups: {
						type: "array",
						items: { $ref: "#/components/schemas/EventQueueGroup" },
					},
					hints: {
						type: "array",
						items: { $ref: "#/components/schemas/QueueHint" },
					},
				},
			},
			QueueHint: {
				type: "object",
				required: ["type", "adminAreaKey", "clusterIds", "message"],
				properties: {
					type: {
						type: "string",
						enum: [
							"same_kind_nearby_duplicate",
							"mutually_exclusive_person_status",
							"gateway_burst_resend",
							"administrative_boundary_uncertain",
						],
					},
					adminAreaKey: { type: "string" },
					clusterIds: { type: "array", items: { type: "string" } },
					message: {
						type: "string",
						description: "Human review prompt, not a decision.",
					},
				},
			},
			EventQueueGroup: {
				type: "object",
				required: [
					"adminAreaKey",
					"label",
					"totalPackets",
					"highestSeverity",
					"latestTs",
					"clusters",
				],
				properties: {
					adminAreaKey: { type: "string" },
					label: { type: "string" },
					totalPackets: { type: "integer", minimum: 0 },
					highestSeverity: { type: "integer", minimum: 0, maximum: 255 },
					latestTs: { type: "integer", minimum: 0 },
					clusters: {
						type: "array",
						items: { $ref: "#/components/schemas/EventCluster" },
					},
				},
			},
			EventCluster: {
				type: "object",
				required: [
					"id",
					"kind",
					"status",
					"count",
					"maxSeverity",
					"latestTs",
					"confidence",
					"receiptState",
					"timeConfidence",
					"boundaryUncertain",
					"centroid",
					"packetIndexes",
				],
				properties: {
					id: { type: "string" },
					kind: {
						type: "string",
						description:
							"Display grouping key such as terrain_event:flood or person_report:rescue_needed.",
					},
					status: { type: "string", enum: ["queued", "watch"] },
					count: { type: "integer", minimum: 1 },
					maxSeverity: {
						type: "integer",
						minimum: 0,
						maximum: 255,
						description:
							"Highest display ordering weight in this cluster; not a danger score or dispatch priority.",
					},
					latestTs: { type: "integer", minimum: 0 },
					confidence: { type: "number", minimum: 0, maximum: 1 },
					receiptState: {
						type: "string",
						enum: ["received", "queued", "review_hint"],
						description: "Receipt state only; not dispatch or case status.",
					},
					timeConfidence: {
						type: "string",
						enum: ["reported_time", "stale_report_time"],
					},
					boundaryUncertain: {
						type: "boolean",
						description:
							"True when demo geocoder places the point near an administrative boundary.",
					},
					centroid: {
						type: "object",
						required: ["lat", "lng"],
						properties: {
							lat: { type: "number", minimum: -90, maximum: 90 },
							lng: { type: "number", minimum: -180, maximum: 180 },
						},
					},
					packetIndexes: {
						type: "array",
						items: { type: "integer", minimum: 0 },
					},
				},
			},
			AgencyExport: {
				type: "object",
				required: [
					"profile",
					"generated_at",
					"sections",
					"note",
					"coord_resolution",
					"verification_mode",
					"semantic_verification",
				],
				properties: {
					profile: {
						type: "string",
						enum: AGENCY_PROFILE_TABLE,
					},
					generated_at: { type: "string", format: "date-time" },
					note: { type: "string" },
					coord_resolution: {
						type: "integer",
						enum: [0, 1, 2, 3, 4],
						default: DEFAULT_COORD_RESOLUTION,
					},
					semantic_verification: {
						$ref: "#/components/schemas/SemanticVerification",
					},
					sections: {
						type: "array",
						items: { $ref: "#/components/schemas/AgencyExportSection" },
					},
					verification_mode: {
						$ref: "#/components/schemas/VerificationMode",
					},
				},
			},
			AgencyExportSection: {
				type: "object",
				required: ["id", "title", "rows"],
				properties: {
					id: { type: "string" },
					title: { type: "string" },
					rows: {
						type: "array",
						items: {
							type: "object",
							description:
								"Flat scalar export row. JSON rows may include receiver_tags or osm_tags_proposed; CSV projection intentionally keeps the legacy header.",
							additionalProperties: {
								oneOf: [
									{ type: "string" },
									{ type: "number" },
									{ type: "boolean" },
								],
							},
							properties: {
								receiver_tags: {
									type: "string",
									description:
										"Semicolon-separated receiver hint tags on needs/resource rows.",
								},
								osm_tags_proposed: {
									type: "string",
									description:
										"Semicolon-separated proposed OSM-style key=value hints on terrain rows.",
								},
								lat: {
									type: "number",
									description:
										"Rounded event-queue centroid latitude for JSON exports.",
								},
								lng: {
									type: "number",
									description:
										"Rounded event-queue centroid longitude for JSON exports.",
								},
								coord_resolution: {
									type: "integer",
									enum: [0, 1, 2, 3, 4],
									description:
										"Decimal places applied to lat/lng on this JSON row.",
								},
							},
						},
					},
				},
			},
			EncodeRequest: {
				type: "object",
				required: ["packet"],
				properties: {
					packet: { $ref: "#/components/schemas/PacketJson" },
				},
			},
			EncodeResponse: {
				type: "object",
				required: ["hex", "counter", "size", "plaintext_size"],
				properties: {
					hex: {
						type: "string",
						pattern: "^[0-9a-fA-F]+$",
						description: "Wire-format frame as lowercase hex.",
					},
					counter: {
						type: "integer",
						minimum: 0,
						maximum: 0xffffffff,
						description:
							"Per-(MAC, packet type) server-assigned demo counter used for nonce construction and returned so the paired decode helper can verify the frame.",
					},
					size: { type: "integer", minimum: 1 },
					plaintext_size: { type: "integer", minimum: 0 },
				},
			},
			DecodeRequest: {
				type: "object",
				required: ["hex", "counter", "mac"],
				properties: {
					hex: { type: "string", pattern: "^(?:[0-9a-fA-F]{2})+$" },
					counter: { type: "integer", minimum: 0, maximum: 0xffffffff },
					mac: {
						type: "string",
						pattern: "^[0-9a-fA-F]{12}$",
						description:
							"Device MAC needed with the frame type byte to derive the nonce; in a real gateway the receiver caches this binding after the first packet.",
					},
				},
			},
			DecodeResponse: {
				type: "object",
				required: ["packet", "verified"],
				properties: {
					packet: { $ref: "#/components/schemas/PacketJson" },
					verified: {
						type: "boolean",
						description: "True after AEAD tag verification succeeds.",
					},
				},
			},
			DemoScenario: {
				type: "object",
				required: [
					"id",
					"label",
					"description",
					"source",
					"location_policy",
					"occurred_at_utc",
					"display_timezone",
					"packets",
				],
				properties: {
					id: { type: "string" },
					label: { type: "string" },
					description: { type: "string" },
					source: { type: "string", enum: ["Synthetic scenario"] },
					location_policy: {
						type: "string",
						enum: ["public_reference_coordinates"],
					},
					occurred_at_utc: { type: "string", format: "date-time" },
					display_timezone: { type: "string", enum: ["Asia/Taipei"] },
					packets: {
						type: "array",
						items: { $ref: "#/components/schemas/PacketJson" },
					},
				},
			},
		},
	},
} as const;
