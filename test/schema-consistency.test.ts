import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	AGENCY_PROFILE_TABLE,
	DEFAULT_COORD_RESOLUTION,
} from "../src/analysis/agency-export.ts";
import { openApiSpec } from "../src/openapi.ts";
import {
	PERSON_FLAG_TABLE,
	PERSON_STATUS_TABLE,
	RESOURCE_FLAG_TABLE,
	RESOURCE_KIND_TABLE,
	TERRAIN_EVENT_TABLE,
	TERRAIN_FLAG_TABLE,
} from "../src/packet/types.ts";
import { MAX_PACKET_BATCH } from "../src/packet/validate.ts";

const packetProperties = (
	name: "PersonReport" | "TerrainEvent" | "ResourceReport",
) => {
	const schema = openApiSpec.components.schemas[name] as any;
	return schema.properties.packet.properties;
};

describe("schema consistency", () => {
	it("keeps OpenAPI packet enums in sync with packet tables", () => {
		expect(packetProperties("PersonReport").status.enum).toEqual(
			PERSON_STATUS_TABLE,
		);
		expect(packetProperties("PersonReport").flags.items.enum).toEqual(
			PERSON_FLAG_TABLE,
		);
		expect(packetProperties("TerrainEvent").event.enum).toEqual(
			TERRAIN_EVENT_TABLE,
		);
		expect(packetProperties("TerrainEvent").flags.items.enum).toEqual(
			TERRAIN_FLAG_TABLE,
		);
		expect(packetProperties("ResourceReport").resource.items.enum).toEqual(
			RESOURCE_KIND_TABLE,
		);
		expect(packetProperties("ResourceReport").flags.items.enum).toEqual(
			RESOURCE_FLAG_TABLE,
		);
	});

	it("documents API validation limits in OpenAPI", () => {
		const batch = openApiSpec.components.schemas.PacketBatch;
		expect(batch.maxItems).toBe(MAX_PACKET_BATCH);
		expect(packetProperties("PersonReport").mac.pattern).toBe(
			"^[0-9a-fA-F]{12}$",
		);
		expect(packetProperties("PersonReport").lat.minimum).toBe(-90);
		expect(packetProperties("PersonReport").lng.maximum).toBe(180);
		expect(packetProperties("ResourceReport").resource.maxItems).toBe(
			RESOURCE_KIND_TABLE.length,
		);
		expect(
			openApiSpec.paths["/api/packets"].post.responses["415"].description,
		).toContain("application/json");
	});

	it("documents event queue output in OpenAPI", () => {
		const result = openApiSpec.components.schemas.AnalysisResult;
		expect(result.required).toContain("event_queue");
		expect(result.required).toContain("semantic_verification");
		expect(result.properties.event_queue).toEqual({
			$ref: "#/components/schemas/EventQueue",
		});
		expect(result.properties.semantic_verification).toEqual({
			$ref: "#/components/schemas/SemanticVerification",
		});
		expect(openApiSpec.components.schemas.EventQueue.required).toContain(
			"hints",
		);
		expect(openApiSpec.components.schemas.EventQueue.properties.hints).toEqual({
			type: "array",
			items: { $ref: "#/components/schemas/QueueHint" },
		});
	});

	it("documents agency export endpoint in OpenAPI", () => {
		expect(openApiSpec.paths["/api/packets/export"].post.summary).toContain(
			"agency",
		);
		expect(
			openApiSpec.paths["/api/packets/export"].post.parameters[0].name,
		).toBe("profile");
		expect(
			openApiSpec.paths["/api/packets/export"].post.parameters[0].schema.enum,
		).toEqual(AGENCY_PROFILE_TABLE);
		const metadataParam =
			openApiSpec.paths["/api/packets/export"].post.parameters[2];
		expect(metadataParam.description).toContain("semantic_verification");
		const coordParam =
			openApiSpec.paths["/api/packets/export"].post.parameters[3];
		expect(coordParam.name).toBe("coord_resolution");
		expect(coordParam.schema).toMatchObject({
			enum: [0, 1, 2, 3, 4],
			default: DEFAULT_COORD_RESOLUTION,
		});
		const row =
			openApiSpec.components.schemas.AgencyExportSection.properties.rows.items;
		expect(row.properties.receiver_tags.description).toContain("receiver hint");
		expect(row.properties.osm_tags_proposed.description).toContain("OSM-style");
		expect(row.properties.coord_resolution.enum).toEqual([0, 1, 2, 3, 4]);
		expect(openApiSpec.components.schemas.AgencyExport.required).toContain(
			"semantic_verification",
		);
		expect(openApiSpec.components.schemas.AgencyExport.required).toContain(
			"coord_resolution",
		);
		expect(
			openApiSpec.components.schemas.AgencyExport.properties.profile.enum,
		).toEqual(AGENCY_PROFILE_TABLE);
		expect(
			openApiSpec.components.schemas.AgencyExport.properties
				.semantic_verification,
		).toEqual({
			$ref: "#/components/schemas/SemanticVerification",
		});
		expect(
			openApiSpec.components.schemas.PacketOverlay.properties.osm_tags_proposed
				.description,
		).toContain("OSM-style");
	});

	it("documents codec helper endpoints in OpenAPI", () => {
		const encode = openApiSpec.paths["/api/codec/encode"].post;
		expect(encode.requestBody.content["application/json"].schema).toEqual({
			$ref: "#/components/schemas/EncodeRequest",
		});
		expect(encode.responses["200"].content["application/json"].schema).toEqual({
			$ref: "#/components/schemas/EncodeResponse",
		});
		const decode = openApiSpec.paths["/api/codec/decode"].post;
		expect(decode.requestBody.content["application/json"].schema).toEqual({
			$ref: "#/components/schemas/DecodeRequest",
		});
		expect(decode.responses["200"].content["application/json"].schema).toEqual({
			$ref: "#/components/schemas/DecodeResponse",
		});
		const encReq = openApiSpec.components.schemas.EncodeRequest as any;
		expect(encReq.required).toEqual(["packet"]);
		expect(encReq.properties).not.toHaveProperty("counter");
		const encRes = openApiSpec.components.schemas.EncodeResponse as any;
		expect(encRes.required).toEqual([
			"hex",
			"counter",
			"size",
			"plaintext_size",
		]);
		expect(encRes.properties.counter.maximum).toBe(0xffffffff);
		const decReq = openApiSpec.components.schemas.DecodeRequest as any;
		expect(decReq.properties.mac.pattern).toBe("^[0-9a-fA-F]{12}$");
		expect(decReq.properties.hex.pattern).toBe("^(?:[0-9a-fA-F]{2})+$");
	});

	it("documents demo scenarios endpoint in OpenAPI", () => {
		const scenarios = openApiSpec.paths["/api/scenarios"].get;
		expect(
			scenarios.responses["200"].content["application/json"].schema,
		).toEqual({
			type: "array",
			items: { $ref: "#/components/schemas/DemoScenario" },
		});
		const schema = openApiSpec.components.schemas.DemoScenario as any;
		expect(schema.required).toEqual([
			"id",
			"label",
			"description",
			"source",
			"location_policy",
			"occurred_at_utc",
			"display_timezone",
			"packets",
		]);
		expect(schema.properties.source.enum).toEqual(["Synthetic scenario"]);
		expect(schema.properties.location_policy.enum).toEqual([
			"public_reference_coordinates",
		]);
		expect(schema.properties.occurred_at_utc.format).toBe("date-time");
		expect(schema.properties.packets.items).toEqual({
			$ref: "#/components/schemas/PacketJson",
		});
	});

	it("advertises the JSON contract and Scalar docs endpoint", () => {
		expect(openApiSpec.paths).not.toHaveProperty("/api/openapi.yaml");
		expect(openApiSpec.paths["/api/openapi.json"].get.responses["200"]).toEqual(
			{
				description: "OpenAPI 3.1 JSON",
			},
		);
		expect(openApiSpec.paths["/api/docs"].get.responses["200"].content).toEqual(
			{
				"text/html": { schema: { type: "string" } },
			},
		);
	});

	it("mentions packet table values in SPEC.md", () => {
		const spec = readFileSync("SPEC.md", "utf8");
		for (const value of TERRAIN_EVENT_TABLE) expect(spec).toContain(value);
		for (const value of TERRAIN_FLAG_TABLE) expect(spec).toContain(value);
		for (const value of RESOURCE_KIND_TABLE) expect(spec).toContain(value);
		for (const value of RESOURCE_FLAG_TABLE) expect(spec).toContain(value);
	});
});
