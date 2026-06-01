import { describe, expect, it } from "vitest";
import {
	buildAgencyExport,
	toAgencyCsv,
} from "../src/analysis/agency-export.ts";
import { analyse } from "../src/analysis/api.ts";
import type { PacketEnvelope, PacketJson } from "../src/packet/types.ts";

const envelope: PacketEnvelope = {
	received_at: "2026-09-23T14:32:11Z",
	gateway_id: "TW-HUA-MAS-001",
	aead_profile: "aead-gcm-128",
	chain_mac: "deadbeef",
};

const publicReferencePoint = { lat: 23.661234, lng: 121.421789 } as const;
const roundingPoint = { lat: 1.23456, lng: 5.67891 } as const;

const person = (
	over: Partial<Extract<PacketJson, { type: "person_report" }>["packet"]>,
): PacketJson => ({
	type: "person_report",
	envelope,
	packet: {
		mac: "5C8AF3000001",
		village: 1003012,
		ts: 1759058400,
		...publicReferencePoint,
		alt: 120,
		addr: "UNKNOWN_FLOOD",
		count: 1,
		status: "rescue_needed",
		flags: ["trapped"],
		...over,
	},
});

const terrain = (
	over: Partial<Extract<PacketJson, { type: "terrain_event" }>["packet"]>,
): PacketJson => ({
	type: "terrain_event",
	envelope,
	packet: {
		mac: "5C8AF3000002",
		ts: 1759058400,
		...publicReferencePoint,
		event: "flood",
		extent_m: 80,
		severity: 180,
		flags: [],
		...over,
	},
});

const resource = (
	over: Partial<Extract<PacketJson, { type: "resource_report" }>["packet"]>,
): PacketJson => ({
	type: "resource_report",
	envelope,
	packet: {
		mac: "5C8AF3000003",
		ts: 1759058420,
		...publicReferencePoint,
		addr: "MOCK01",
		resource: ["warmth_supplies"],
		quantity: 11,
		duration: 0,
		flags: ["is_request", "urgent"],
		...over,
	},
});

describe("agency export profiles", () => {
	it("builds profile-specific views from the same analysis result", () => {
		const result = analyse(
			[
				person({ status: "rescue_needed", flags: ["trapped"], count: 2 }),
				resource({ resource: ["warmth_supplies"], quantity: 11 }),
			],
			"2026-09-23T14:40:00Z",
		);

		expect(
			buildAgencyExport(result, "township").sections.map((s) => s.id),
		).toEqual(["event_queue", "alerts", "summary"]);
		expect(
			buildAgencyExport(result, "social").sections.map((s) => s.id),
		).toContain("needs_flags");
		expect(
			buildAgencyExport(result, "partner").sections.map((s) => s.id),
		).toEqual(["resource_requests", "resource_offers"]);
	});

	it("builds T-CERT, lifeline, and healthcare partner views without person details", () => {
		const result = analyse(
			[
				person({
					flags: ["injured", "long_term_care", "migrant_worker"],
					count: 2,
				}),
				terrain({ event: "signal_lost", severity: 160, ts: 120 }),
				terrain({ event: "flood", severity: 180, ts: 121 }),
				resource({
					resource: ["communication"],
					quantity: 3,
					flags: ["is_request", "urgent"],
					ts: 122,
				}),
				resource({
					resource: ["power_generator"],
					quantity: 2,
					flags: [],
					ts: 123,
				}),
				resource({
					resource: ["medical_aid"],
					quantity: 4,
					flags: ["is_request"],
					ts: 124,
				}),
			],
			"2026-09-23T14:40:00Z",
		);
		const partner = buildAgencyExport(result, "partner");
		const lifeline = buildAgencyExport(result, "lifeline");
		const healthcare = buildAgencyExport(result, "healthcare");

		expect(partner.sections.map((section) => section.id)).toEqual([
			"resource_requests",
			"resource_offers",
		]);
		expect(
			partner.sections.find((section) => section.id === "resource_offers")
				?.rows,
		).toContainEqual(
			expect.objectContaining({ resource: "power_generator", quantity: 2 }),
		);
		expect(
			lifeline.sections
				.find((section) => section.id === "event_queue")
				?.rows.map((row) => row.kind),
		).toEqual(["terrain_event:signal_lost"]);
		expect(
			lifeline.sections.find((section) => section.id === "resource_requests")
				?.rows,
		).toEqual([
			expect.objectContaining({ resource: "communication", quantity: 3 }),
		]);
		expect(
			healthcare.sections.find((section) => section.id === "needs_flags")?.rows,
		).toEqual([
			expect.objectContaining({ flag: "injured", count: 2 }),
			expect.objectContaining({ flag: "care_continuity_support", count: "<5" }),
		]);
		expect(
			healthcare.sections.find((section) => section.id === "resource_requests")
				?.rows,
		).toEqual([
			expect.objectContaining({ resource: "medical_aid", quantity: 4 }),
		]);
	});

	it("adds duplicate and conflict hints without deciding which packet is correct", () => {
		const result = analyse(
			[
				person({
					status: "rescue_needed",
					ts: 100,
					...publicReferencePoint,
				}),
				person({
					status: "rescue_needed",
					ts: 101,
					...publicReferencePoint,
				}),
				person({
					status: "evacuated_shelter",
					ts: 102,
					...publicReferencePoint,
				}),
				terrain({ event: "flood", severity: 180, ts: 103 }),
			],
			"2026-09-23T14:40:00Z",
		);

		const hints = result.event_queue.hints.map((hint) => hint.type);
		expect(hints).toContain("same_kind_nearby_duplicate");
		expect(hints).toContain("mutually_exclusive_person_status");
	});

	it("exports queue clusters as CSV for spreadsheet workflows", () => {
		const result = analyse(
			[
				terrain({ event: "flood", severity: 180, ts: 120 }),
				resource({ resource: ["warmth_supplies"], quantity: 11, ts: 130 }),
			],
			"2026-09-23T14:40:00Z",
		);
		const csv = toAgencyCsv(buildAgencyExport(result, "township"));

		expect(csv.charCodeAt(0)).toBe(0xfeff);
		expect(csv.split("\n")[0]).toBe(
			"\ufeffprofile,section,area,cluster_id,kind,status,count,max_severity,latest_ts",
		);
		expect(csv).toContain(
			"township,event_queue,Hualien County/Guangfu Township",
		);
	});

	it("keeps sensitive proxy needs grouped while preserving resource hint tags", () => {
		const result = analyse(
			[
				person({
					status: "rescue_needed",
					flags: [
						"trapped",
						"requires_separated_space",
						"migrant_worker",
						"consent_refused",
					],
					count: 2,
				}),
				resource({
					resource: ["food_water"],
					quantity: 3,
					flags: ["is_request", "urgent"],
				}),
			],
			"2026-09-23T14:40:00Z",
		);
		const social = buildAgencyExport(result, "social");
		const needs = social.sections.find(
			(section) => section.id === "needs_flags",
		);
		const resources = social.sections.find(
			(section) => section.id === "resource_requests",
		);

		expect(needs?.rows).toContainEqual({
			flag: "trapped",
			count: 2,
			receiver_tags: "#affected+trapped+ind",
		});
		expect(needs?.rows).toContainEqual({
			flag: "restricted_welfare_support",
			count: "<5",
		});
		expect(needs?.rows).toContainEqual({
			flag: "language_or_nonlocal_support",
			count: "<5",
		});
		expect(JSON.stringify(needs?.rows)).not.toContain("migrant_worker");
		expect(JSON.stringify(needs?.rows)).not.toContain(
			"requires_separated_space",
		);
		expect(JSON.stringify(needs?.rows)).not.toContain("consent_refused");
		expect(resources?.rows).toContainEqual({
			resource: "food_water",
			quantity: 3,
			urgent: true,
			receiver_tags: "#inneed+food+urgent;#inneed+water+urgent",
		});
	});

	it("adds proposed OSM tags to terrain event queue JSON rows", () => {
		const result = analyse(
			[
				terrain({ event: "landslide", severity: 224, ts: 120 }),
				resource({ resource: ["warmth_supplies"], quantity: 11, ts: 130 }),
			],
			"2026-09-23T14:40:00Z",
		);
		const queue = buildAgencyExport(result, "township").sections.find(
			(section) => section.id === "event_queue",
		);

		expect(queue?.rows).toContainEqual(
			expect.objectContaining({
				kind: "terrain_event:landslide",
				osm_tags_proposed:
					"barrier:obstacle_type=landslide_mudslide;practicability=no;access=emergency",
			}),
		);
	});

	it("rounds agency JSON queue centroids to two decimals by default", () => {
		const result = analyse(
			[
				terrain({
					event: "road_blocked",
					...roundingPoint,
					severity: 170,
					ts: 120,
				}),
			],
			"2026-09-23T14:40:00Z",
		);
		const exportData = buildAgencyExport(result, "township");
		const queue = exportData.sections.find(
			(section) => section.id === "event_queue",
		);

		expect(exportData.coord_resolution).toBe(2);
		expect(queue?.rows[0]).toMatchObject({
			lat: 1.23,
			lng: 5.68,
			coord_resolution: 2,
		});
	});

	it("allows coarser agency JSON queue centroid output", () => {
		const result = analyse(
			[
				terrain({
					event: "road_blocked",
					...roundingPoint,
					severity: 170,
					ts: 120,
				}),
			],
			"2026-09-23T14:40:00Z",
		);
		const exportData = buildAgencyExport(result, "township", {
			coord_resolution: 2,
		});
		const queue = exportData.sections.find(
			(section) => section.id === "event_queue",
		);

		expect(exportData.coord_resolution).toBe(2);
		expect(queue?.rows[0]).toMatchObject({
			lat: 1.23,
			lng: 5.68,
			coord_resolution: 2,
		});
	});

	it("escapes spreadsheet formula injection in CSV cells", () => {
		const csv = toAgencyCsv({
			profile: "township",
			generated_at: "2026-09-23T14:40:00Z",
			note: "test",
			semantic_verification: "field_observation_unverified_truth",
			coord_resolution: 2,
			sections: [
				{
					id: "event_queue",
					title: "Event queue clusters",
					rows: [
						{
							area: "=cmd",
							cluster_id: "+SUM(1,2)",
							kind: "@x",
							status: "-1",
							count: 1,
							max_severity: 1,
							latest_ts: 1,
						},
					],
				},
			],
		});

		expect(csv).toContain("event_queue,'=cmd");
		expect(csv).toContain('"\'+SUM(1,2)"');
		expect(csv).toContain("'@x");
		expect(csv).toContain("'-1");
	});
});
