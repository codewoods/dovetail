import { describe, expect, it } from "vitest";
import { DEMO_SCENARIOS } from "../src/demo/scenarios.ts";
import worker from "../src/index.ts";

const postJson = (url: string, body: unknown): Promise<Response> =>
	worker.fetch(
		new Request(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);

describe("privacy release surfaces", () => {
	it("keeps /api/packets as a restricted receiver surface with precise test coordinates", async () => {
		const packet = DEMO_SCENARIOS[0]!.packets[0]!;
		const response = await postJson("https://example.org/api/packets", [
			packet,
		]);
		const body = (await response.json()) as {
			overlays: { lat: number; lng: number }[];
			event_queue: {
				groups: { clusters: { centroid: { lat: number; lng: number } }[] }[];
			};
		};

		expect(response.status).toBe(200);
		expect(body.overlays[0]).toMatchObject({
			lat: packet.packet.lat,
			lng: packet.packet.lng,
		});
		expect(body.overlays[0]?.lat).not.toBe(
			Math.round(packet.packet.lat * 100) / 100,
		);
		expect(body.event_queue.groups[0]?.clusters[0]?.centroid).toMatchObject({
			lat: packet.packet.lat,
			lng: packet.packet.lng,
		});
	});

	it("rounds agency JSON export centroids and labels the coordinate resolution", async () => {
		const packet = DEMO_SCENARIOS[0]!.packets[0]!;
		const response = await postJson(
			"https://example.org/api/packets/export?profile=township&format=json",
			[packet],
		);
		const body = (await response.json()) as {
			coord_resolution: number;
			sections: { id: string; rows: Record<string, unknown>[] }[];
		};
		const queueRow = body.sections.find(
			(section) => section.id === "event_queue",
		)?.rows[0];

		expect(response.status).toBe(200);
		expect(body.coord_resolution).toBe(2);
		expect(queueRow).toMatchObject({
			lat: Math.round(packet.packet.lat * 100) / 100,
			lng: Math.round(packet.packet.lng * 100) / 100,
			coord_resolution: 2,
		});
		expect(queueRow).not.toHaveProperty("packetIndexes");
	});

	it("keeps agency CSV exports free of coordinate columns and precise coordinate values", async () => {
		const packet = DEMO_SCENARIOS[0]!.packets[0]!;
		const response = await postJson(
			"https://example.org/api/packets/export?profile=township&format=csv",
			[packet],
		);
		const csv = await response.text();

		expect(response.status).toBe(200);
		expect(csv.split("\n")[0]?.replace(/^\ufeff/, "")).toBe(
			"profile,section,area,cluster_id,kind,status,count,max_severity,latest_ts",
		);
		expect(csv).not.toContain(String(packet.packet.lat));
		expect(csv).not.toContain(String(packet.packet.lng));
	});
});
