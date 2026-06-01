import { describe, expect, it } from "vitest";
import { overlay } from "../src/analysis/overlay.ts";
import type { PacketJson } from "../src/packet/types.ts";

const envelope = {
	received_at: "2026-09-23T14:32:11Z",
	gateway_id: "G1",
	aead_profile: "aead-gcm-128" as const,
	chain_mac: "ab",
};

const publicReferencePoint = { lat: 23.661234, lng: 121.421789 } as const;
const syntheticPoint = { lat: 0.125, lng: 0.25 } as const;
const outsideSupportedAreaPoint = { lat: 0.5, lng: 0.5 } as const;

describe("overlay", () => {
	it("marks packets inside the demo flood polygon as inZone", () => {
		const packets: PacketJson[] = [
			{
				type: "person_report",
				envelope,
				packet: {
					mac: "M1",
					village: 1,
					ts: 1,
					...publicReferencePoint,
					alt: 100,
					addr: "X",
					count: 1,
					status: "rescue_needed",
					flags: [],
				},
			},
		];
		const out = overlay(packets);
		expect(out[0]?.zone.inZone).toBe(true);
		expect(out[0]?.zone.source).toBeDefined();
	});

	it("marks packets outside Hualien with conservative confidence", () => {
		const packets: PacketJson[] = [
			{
				type: "person_report",
				envelope,
				packet: {
					mac: "M1",
					village: 1,
					ts: 1,
					...outsideSupportedAreaPoint,
					alt: 30,
					addr: "X",
					count: 1,
					status: "unknown",
					flags: [],
				},
			},
		];
		const out = overlay(packets);
		expect(out[0]?.zone.inZone).toBe(false);
		expect(out[0]?.zone.confidence).toBeLessThan(0.5);
	});

	it("adds proposed OSM tags for terrain-event overlays", () => {
		const packets: PacketJson[] = [
			{
				type: "terrain_event",
				envelope,
				packet: {
					mac: "M2",
					ts: 2,
					...syntheticPoint,
					event: "flood",
					extent_m: 80,
					severity: 180,
					flags: [],
				},
			},
		];
		const out = overlay(packets);

		expect(out[0]?.osm_tags_proposed).toBe("flood_prone=yes;practicability=no");
	});
});
