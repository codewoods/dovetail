import { afterEach, describe, expect, it } from "vitest";
import { DEMO_SCENARIOS } from "../src/demo/scenarios.ts";
import worker from "../src/index.ts";
import type { PacketJson } from "../src/packet/types.ts";

const publicReferencePoint = { lat: 23.661234, lng: 121.421789 } as const;
const roundingPoint = { lat: 1.23456, lng: 5.67891 } as const;

/**
 * Exercise the fetch handler rather than buildAgencyExport directly so API
 * tests cover validation, query parsing, and JSON serialization together.
 */
const exportUrl = (profile: string, format: string, extraQuery = ""): string =>
	`https://example.org/api/packets/export?profile=${profile}&format=${format}${extraQuery}`;

/** Keep tests on the public fetch boundary instead of internal export helpers. */
const postExportPackets = (
	profile: string,
	format: string,
	packets: readonly PacketJson[],
	extraQuery = "",
): Promise<Response> => {
	const body = JSON.stringify(packets);
	const request = new Request(exportUrl(profile, format, extraQuery), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
	});
	return worker.fetch(request);
};

const agencyExportPackets = (): readonly PacketJson[] => {
	const scenario = DEMO_SCENARIOS.find(
		(item) => item.id === "public-facility-resource-synthetic",
	);
	if (!scenario) throw new Error("Missing agency export demo scenario");
	return scenario.packets;
};

const postExport = (profile: string, format: string): Promise<Response> => {
	const packets = agencyExportPackets();
	return postExportPackets(profile, format, packets);
};

afterEach(() => {
	delete process.env.DOVETAIL_EXPORT_PROFILES;
	delete process.env.DOVETAIL_DEPLOYMENT_MODE;
});

/** Minimal terrain packet with precise coordinates so export rounding is visible at the HTTP boundary. */
const terrainPacket = (lat: number, lng: number): PacketJson => ({
	type: "terrain_event",
	envelope: {
		received_at: "2025-09-28T11:20:20Z",
		gateway_id: "G1",
		aead_profile: "aead-gcm-128",
		chain_mac: "a".repeat(64),
	},
	packet: {
		mac: "5C8AF3000004",
		ts: 1759058420,
		lat,
		lng,
		event: "road_blocked",
		extent_m: 40,
		severity: 170,
		flags: ["only_exit_control"],
	},
});

describe("agency export API", () => {
	it("rejects removed ngo profile requests", async () => {
		const response = await postExport("ngo", "json");

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "invalid_export_profile" });
	});

	it("returns JSON-only receiver hint tags for agency exports", async () => {
		const response = await postExportPackets("partner", "json", [
			{
				type: "resource_report",
				envelope: {
					received_at: "2025-09-28T11:20:20Z",
					gateway_id: "G1",
					aead_profile: "aead-gcm-128",
					chain_mac: "a".repeat(64),
				},
				packet: {
					mac: "5C8AF3000003",
					ts: 1759058420,
					...publicReferencePoint,
					addr: "MOCK01",
					resource: ["shelter_space"],
					quantity: 4,
					duration: 0,
					flags: ["is_request", "urgent"],
				},
			},
		]);
		const body = (await response.json()) as {
			sections: Array<{ id: string; rows: Array<Record<string, unknown>> }>;
		};

		expect(response.status).toBe(200);
		expect(body.sections[0]?.rows).toContainEqual({
			resource: "shelter_space",
			quantity: 4,
			urgent: true,
			receiver_tags: "#inneed+shelter+urgent",
		});
	});

	it("accepts functional partner profiles for T-CERT-style resource nodes", async () => {
		const response = await postExport("partner", "json");
		const body = (await response.json()) as {
			profile: string;
			sections: Array<{ id: string }>;
		};

		expect(response.status).toBe(200);
		expect(body.profile).toBe("partner");
		expect(body.sections.map((section) => section.id)).toEqual([
			"resource_requests",
			"resource_offers",
		]);
	});

	it("returns CSV exports for spreadsheet workflows", async () => {
		const response = await postExport("township", "csv");
		const body = await response.text();
		const contentType = response.headers.get("content-type");

		expect(contentType).toContain("text/csv");
		expect(body).toContain(
			"profile,section,area,cluster_id,kind,status,count,max_severity,latest_ts",
		);
		expect(body).toContain("township,event_queue");
	});

	it("defaults agency JSON coordinates to two decimal places", async () => {
		const response = await postExportPackets("township", "json", [
			terrainPacket(roundingPoint.lat, roundingPoint.lng),
		]);
		const body = (await response.json()) as {
			coord_resolution: number;
			sections: Array<{ id: string; rows: Array<Record<string, unknown>> }>;
		};
		const queue = body.sections.find((section) => section.id === "event_queue");

		expect(response.status).toBe(200);
		expect(body.coord_resolution).toBe(2);
		expect(queue?.rows[0]).toMatchObject({
			lat: 1.23,
			lng: 5.68,
			coord_resolution: 2,
		});
	});

	it("accepts only coarser or default coordinate resolution on agency export", async () => {
		const coarse = await postExportPackets(
			"township",
			"json",
			[terrainPacket(roundingPoint.lat, roundingPoint.lng)],
			"&coord_resolution=2",
		);
		const coarseBody = (await coarse.json()) as {
			sections: Array<{ id: string; rows: Array<Record<string, unknown>> }>;
		};
		const invalid = await postExportPackets(
			"township",
			"json",
			[terrainPacket(roundingPoint.lat, roundingPoint.lng)],
			"&coord_resolution=5",
		);

		expect(coarse.status).toBe(200);
		expect(coarseBody.sections[0]?.rows[0]).toMatchObject({
			lat: 1.23,
			lng: 5.68,
			coord_resolution: 2,
		});
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toEqual({ error: "invalid_coord_resolution" });
	});

	it("rejects export profiles outside the deployment allowlist", async () => {
		process.env.DOVETAIL_EXPORT_PROFILES = "partner";
		const denied = await postExport("central", "json");
		const allowed = await postExport("partner", "json");

		expect(denied.status).toBe(403);
		expect(await denied.json()).toEqual({
			error: "export_profile_not_allowed",
		});
		expect(allowed.status).toBe(200);
	});

	it("fails closed in production when export profiles are not allowlisted", async () => {
		process.env.DOVETAIL_DEPLOYMENT_MODE = "production";
		const response = await postExport("partner", "json");

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: "export_profile_allowlist_not_configured",
		});
	});

	it("rejects unknown profiles", async () => {
		const response = await postExport("admin-root", "json");
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body).toEqual({ error: "invalid_export_profile" });
	});
});
