import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { queryHazardZone } from "../src/analysis/api.ts";
import worker from "../src/index.ts";

describe("queryHazardZone", () => {
	it("keeps hazard-zone lookup on ordered bbox-prefilter path", () => {
		const source = readFileSync("src/danger-zones.ts", "utf8");

		expect(source).toContain("candidateBboxContains");
		expect(source).not.toContain(".filter(");
	});

	it("returns Hualien geocode + zone hit for a point inside demo polygon", () => {
		const result = queryHazardZone({ lat: 23.661234, lng: 121.421789 });
		expect(result).not.toBeNull();
		expect(result?.scenario).toBe("local_hazard");
		expect(result?.zone.inZone).toBe(true);
		expect(result?.zone.zoneId).toBe("hualien-mataian-flood-demo");
	});

	it("returns unknown scenario for a point outside Hualien bbox", () => {
		const result = queryHazardZone({ lat: 0.5, lng: 0.5 });
		expect(result?.scenario).toBe("unknown");
		expect(result?.zone.inZone).toBe(false);
	});

	it("rejects invalid lat/lng with null", () => {
		expect(queryHazardZone({ lat: NaN, lng: 121 })).toBeNull();
		expect(queryHazardZone({ lat: 23, lng: 999 })).toBeNull();
	});

	it("serves /api/hazard-zone and removes the misleading /api/risk route", async () => {
		const hazard = await worker.fetch(
			new Request(
				"https://example.org/api/hazard-zone?lat=23.661234&lng=121.421789",
			),
		);
		const retired = await worker.fetch(
			new Request("https://example.org/api/risk?lat=23.661234&lng=121.421789"),
		);

		expect(hazard.status).toBe(200);
		expect(await hazard.json()).toMatchObject({
			input: { lat: 23.661234, lng: 121.421789 },
			zone: { inZone: true, zoneId: "hualien-mataian-flood-demo" },
		});
		expect(retired.status).toBe(404);
		expect(await retired.json()).toEqual({ error: "not_found" });
	});
});
