import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyse } from "../src/analysis/api.ts";
import { buildEventQueue } from "../src/analysis/event-queue.ts";
import type { PacketEnvelope, PacketJson } from "../src/packet/types.ts";

const envelope: PacketEnvelope = {
	received_at: "2026-09-23T14:32:11Z",
	gateway_id: "TW-HUA-MAS-001",
	aead_profile: "aead-gcm-128",
	chain_mac: "deadbeef",
};

const publicReferencePoint = { lat: 23.661234, lng: 121.421789 } as const;

const terrain = (
	over: Partial<Extract<PacketJson, { type: "terrain_event" }>["packet"]>,
): PacketJson => ({
	type: "terrain_event",
	envelope,
	packet: {
		mac: "5C8AF3000001",
		ts: 1759058400,
		...publicReferencePoint,
		event: "flood",
		extent_m: 80,
		severity: 120,
		flags: [],
		...over,
	},
});

const person = (
	over: Partial<Extract<PacketJson, { type: "person_report" }>["packet"]>,
): PacketJson => ({
	type: "person_report",
	envelope,
	packet: {
		mac: "5C8AF3000002",
		village: 1003012,
		ts: 1759058410,
		...publicReferencePoint,
		alt: 120,
		addr: "UNKNOWN_FLOOD",
		count: 1,
		status: "rescue_needed",
		flags: ["trapped"],
		...over,
	},
});

describe("event queue", () => {
	it("keeps clustering implementation on the low-allocation path", () => {
		const source = readFileSync("src/analysis/event-queue-clusters.ts", "utf8");

		expect(source).not.toContain("reduce<EventCluster[]>");
		expect(source).not.toContain("policy.priorityOrder.indexOf(kind)");
		expect(source).toContain("buildPriorityLookup");
	});

	it("uses shared spatial facts instead of per-consumer geocode calls", () => {
		const apiSource = readFileSync("src/analysis/api.ts", "utf8");
		const overlaySource = readFileSync("src/analysis/overlay.ts", "utf8");
		const queueSource = readFileSync(
			"src/analysis/event-queue-clusters.ts",
			"utf8",
		);

		expect(apiSource).toContain("buildSpatialFacts");
		expect(overlaySource).not.toContain('from "../geocode.ts"');
		expect(queueSource).not.toContain('from "../geocode.ts"');
	});

	it("groups nearby same-kind reports into sorted village queue clusters", () => {
		const queue = buildEventQueue([
			terrain({
				event: "flood",
				severity: 150,
				ts: 1759058500,
				...publicReferencePoint,
			}),
			terrain({
				event: "flood",
				severity: 180,
				ts: 1759058520,
				...publicReferencePoint,
			}),
			terrain({
				event: "landslide",
				severity: 230,
				ts: 1759058490,
				...publicReferencePoint,
			}),
			person({
				status: "rescue_needed",
				count: 3,
				ts: 1759058530,
				...publicReferencePoint,
			}),
		]);

		expect(queue.totalPackets).toBe(4);
		expect(queue.groups).toHaveLength(1);
		expect(queue.groups[0]?.adminAreaKey).toBe(
			"Hualien County/Guangfu Township",
		);
		expect(queue.groups[0]?.clusters.map((cluster) => cluster.kind)).toEqual([
			"terrain_event:landslide",
			"person_report:rescue_needed",
			"terrain_event:flood",
		]);
		expect(queue.groups[0]?.clusters[2]).toMatchObject({
			count: 2,
			maxSeverity: 180,
			latestTs: 1759058520,
			status: "queued",
			receiptState: "queued",
			timeConfidence: "reported_time",
		});
	});

	it("is included in analysis results for HTTP consumers", () => {
		const result = analyse(
			[
				terrain({ event: "drainage_backflow", severity: 210, ts: 200 }),
				person({ status: "refused", count: 2, ts: 210 }),
			],
			"2026-09-23T14:40:00Z",
		);

		expect(result.event_queue.totalPackets).toBe(2);
		expect(result.event_queue.groups[0]?.clusters[0]?.kind).toBe(
			"terrain_event:drainage_backflow",
		);
	});

	it("accepts bounded operator policy for priority and queue status", () => {
		const queue = buildEventQueue(
			[
				terrain({
					event: "landslide",
					severity: 230,
					ts: 100,
					...publicReferencePoint,
				}),
				terrain({
					event: "flood",
					severity: 230,
					ts: 90,
					...publicReferencePoint,
				}),
			],
			{
				priorityOrder: ["terrain_event:flood"],
				queuedSeverityThreshold: 240,
				clusterRadiusDeg: 0.003,
				personStatusSeverity: {
					unknown: 140,
					evacuated_shelter: 60,
					evacuated_relatives: 60,
					vertical_evacuated: 60,
					refused: 140,
					rescue_needed: 220,
					self_evacuated_neighbor: 60,
					address_lost: 220,
				},
			},
		);

		expect(queue.groups[0]?.clusters.map((cluster) => cluster.kind)).toEqual([
			"terrain_event:flood",
			"terrain_event:landslide",
		]);
		expect(queue.groups[0]?.clusters[0]?.status).toBe("watch");
	});

	it("marks stale report times", () => {
		const queue = buildEventQueue([
			terrain({
				event: "flood",
				severity: 180,
				ts: 1,
				...publicReferencePoint,
			}),
		]);

		expect(queue.groups[0]?.clusters[0]?.timeConfidence).toBe(
			"stale_report_time",
		);
	});
});
