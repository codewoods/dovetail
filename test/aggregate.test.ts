import { describe, expect, it } from "vitest";
import { aggregate } from "../src/analysis/aggregate.ts";
import type { PacketJson } from "../src/packet/types.ts";

const envelope = {
	received_at: "2026-09-23T14:32:11Z",
	gateway_id: "TW-HUA-MAS-001",
	aead_profile: "aead-gcm-128" as const,
	chain_mac: "deadbeef",
};

const personPacket = (
	over: Partial<Extract<PacketJson, { type: "person_report" }>["packet"]> = {},
): PacketJson => ({
	type: "person_report",
	envelope,
	packet: {
		mac: "5C8AF3000001",
		village: 1003012,
		ts: 1759058400,
		lat: 0.125,
		lng: 0.25,
		alt: 142,
		addr: "CNC5630-5",
		count: 1,
		status: "evacuated_shelter",
		flags: [],
		...over,
	},
});

describe("aggregate", () => {
	it("counts status totals across packets", () => {
		const summary = aggregate([
			personPacket({ status: "evacuated_shelter", count: 3 }),
			personPacket({ status: "rescue_needed", count: 2 }),
			personPacket({ status: "evacuated_shelter", count: 1 }),
		]);
		expect(summary.status_totals.evacuated_shelter).toBe(4);
		expect(summary.status_totals.rescue_needed).toBe(2);
		expect(summary.packet_count).toBe(3);
	});

	it("buckets small village status counts while preserving exact larger counts", () => {
		const summary = aggregate([
			personPacket({ village: 1001, status: "refused", count: 1 }),
			personPacket({ village: 1002, status: "refused", count: 1 }),
			personPacket({ village: 1001, status: "rescue_needed", count: 2 }),
			personPacket({ village: 1003, status: "evacuated_shelter", count: 5 }),
		]);
		expect(summary.village_counts["1001"]?.refused).toBe("<5");
		expect(summary.village_counts["1001"]?.rescue_needed).toBe("<5");
		expect(summary.village_counts["1002"]?.refused).toBe("<5");
		expect(summary.village_counts["1003"]?.evacuated_shelter).toBe(5);
	});

	it("sums flag totals by count, ignoring unknown flags", () => {
		const summary = aggregate([
			personPacket({ flags: ["trapped", "long_term_care"], count: 1 }),
			personPacket({ flags: ["trapped", "injured"], count: 2 }),
			personPacket({ flags: ["consent_acknowledged"], count: 1 }),
		]);
		expect(summary.flag_totals.trapped).toBe(3);
		expect(summary.flag_totals.long_term_care).toBe(1);
		expect(summary.flag_totals.injured).toBe(2);
	});

	it("separates resource offers and requests", () => {
		const summary = aggregate([
			{
				type: "resource_report",
				envelope,
				packet: {
					mac: "AABBCCDDEEFF",
					ts: 1759058500,
					lat: 0.125,
					lng: 0.25,
					addr: "CNC0000-1",
					resource: ["food_water", "shelter_space"],
					quantity: 5,
					duration: 24,
					flags: [],
				},
			},
			{
				type: "resource_report",
				envelope,
				packet: {
					mac: "AABBCCDDEEFF",
					ts: 1759058600,
					lat: 0.125,
					lng: 0.25,
					addr: "CNC0000-2",
					resource: ["food_water"],
					quantity: 3,
					duration: 0,
					flags: ["is_request", "urgent"],
				},
			},
		]);
		expect(summary.resource_offers.food_water).toBe(5);
		expect(summary.resource_offers.shelter_space).toBe(5);
		expect(summary.resource_requests.food_water).toBe(3);
	});

	it("sums warmth supply requests", () => {
		const summary = aggregate([
			{
				type: "resource_report",
				envelope,
				packet: {
					mac: "AABBCCDDEEFF",
					ts: 1759058600,
					lat: 0.125,
					lng: 0.25,
					addr: "CNC0000-2",
					resource: ["warmth_supplies"],
					quantity: 11,
					duration: 0,
					flags: ["is_request", "urgent"],
				},
			},
		]);
		expect(summary.resource_requests.warmth_supplies).toBe(11);
	});

	it("sums menstrual supply requests", () => {
		const summary = aggregate([
			{
				type: "resource_report",
				envelope,
				packet: {
					mac: "AABBCCDDEEFF",
					ts: 1759058600,
					lat: 0.125,
					lng: 0.25,
					addr: "CNC0000-2",
					resource: ["menstrual_supplies"],
					quantity: 20,
					duration: 0,
					flags: ["is_request", "urgent"],
				},
			},
		]);
		expect(summary.resource_requests.menstrual_supplies).toBe(20);
	});

	it("collects terrain events with severity", () => {
		const summary = aggregate([
			{
				type: "terrain_event",
				envelope,
				packet: {
					mac: "5C8AF3000002",
					ts: 1759058700,
					lat: 0.125,
					lng: 0.25,
					event: "landslide",
					extent_m: 80,
					severity: 220,
					flags: [],
				},
			},
		]);
		expect(summary.terrain_events).toHaveLength(1);
		expect(summary.terrain_events[0]?.event).toBe("landslide");
		expect(summary.terrain_events[0]?.severity).toBe(220);
	});

	it("preserves terrain event flags for downstream alerts", () => {
		const summary = aggregate([
			{
				type: "terrain_event",
				envelope,
				packet: {
					mac: "5C8AF3000002",
					ts: 1759058700,
					lat: 0.125,
					lng: 0.25,
					event: "drainage_backflow",
					extent_m: 350,
					severity: 210,
					flags: ["rapid_rainfall", "backflow_observed"],
				},
			},
		]);
		expect(summary.terrain_events[0]?.flags).toEqual([
			"rapid_rainfall",
			"backflow_observed",
		]);
	});
});
