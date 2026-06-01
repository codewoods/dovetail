import { describe, expect, it } from "vitest";
import {
	buildAgencyExport,
	toAgencyCsv,
} from "../src/analysis/agency-export.ts";
import type { AnalysisResult } from "../src/analysis/api.ts";
import { analyse, partitionIngressPackets } from "../src/analysis/api.ts";
import { replayKeyOf } from "../src/analysis/replay.ts";
import type { PacketEnvelope, PacketJson } from "../src/packet/types.ts";

const envelope: PacketEnvelope = {
	received_at: "2025-09-28T11:20:20Z",
	gateway_id: "TW-HUA-MAS-001",
	aead_profile: "aead-gcm-128",
	chain_mac: "a".repeat(64),
};

const publicReferencePoint = { lat: 23.661234, lng: 121.421789 } as const;
const roundedPublicReferencePoint = {
	lat: Math.round(publicReferencePoint.lat * 100) / 100,
	lng: Math.round(publicReferencePoint.lng * 100) / 100,
} as const;
const publicReferenceBucket = `${roundedPublicReferencePoint.lat},${roundedPublicReferencePoint.lng}`;
const townshipClusterId = (kind: string): string =>
	`Hualien County/Guangfu Township:${kind}:${publicReferenceBucket}`;

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
		alt: 142,
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
		ts: 1759058410,
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

/** Canonical accepted packet order for the packet-to-export lineage fixture. */
const canonicalAcceptedPackets = (): PacketJson[] => [
	terrain({ event: "flood", severity: 150, ts: 1759058400 }),
	terrain({
		event: "flood",
		severity: 190,
		ts: 1759058410,
		...publicReferencePoint,
	}),
	person({ status: "rescue_needed", count: 2, ts: 1759058420 }),
	resource({ resource: ["warmth_supplies"], quantity: 11 }),
];

const canonicalAnalysis = (): AnalysisResult =>
	analyse(canonicalAcceptedPackets(), "2026-09-23T14:40:00Z");

/** Raw ingress fixture appends rejected packets after accepted lineage rows. */
const canonicalIngressPackets = (): PacketJson[] => [
	...canonicalAcceptedPackets(),
	terrain({ event: "flood", severity: 155, ts: 1759058400 }),
	terrain({
		mac: "5C8AF30000FF",
		event: "flood",
		severity: 210,
		ts: 1759050000,
	}),
];

const packetSignature = ({ type, packet }: PacketJson): string =>
	`${type}:${packet.mac}:${packet.ts}`;

const alertRefsResolve = (result: AnalysisResult, refs: string): boolean =>
	refs.split("|").every((ref) => {
		if (ref.startsWith("packets[")) {
			const index = Number(ref.match(/^packets\[(\d+)\]$/)?.[1]);
			return Number.isInteger(index) && result.overlays[index] !== undefined;
		}
		return (
			ref.split(".").reduce<unknown>((value, key) => {
				if (value === null || typeof value !== "object") return undefined;
				return (value as Record<string, unknown>)[key];
			}, result.summary) !== undefined
		);
	});

describe("data lineage", () => {
	it("pins raw input order and accepted/rejected split before analysis", async () => {
		const packets = canonicalIngressPackets();
		const { accepted, rejected } = await partitionIngressPackets(packets);
		const duplicateReplayKey = await replayKeyOf(packets[4]!);
		const staleReplayKey = await replayKeyOf(packets[5]!);

		expect(packets.map(packetSignature)).toEqual([
			"terrain_event:5C8AF3000002:1759058400",
			"terrain_event:5C8AF3000002:1759058410",
			"person_report:5C8AF3000001:1759058420",
			"resource_report:5C8AF3000003:1759058420",
			"terrain_event:5C8AF3000002:1759058400",
			"terrain_event:5C8AF30000FF:1759050000",
		]);
		expect(accepted.map(packetSignature)).toEqual([
			"terrain_event:5C8AF3000002:1759058400",
			"terrain_event:5C8AF3000002:1759058410",
			"person_report:5C8AF3000001:1759058420",
			"resource_report:5C8AF3000003:1759058420",
		]);
		expect(rejected).toEqual([
			{
				index: 4,
				replay_key: duplicateReplayKey,
				reason: "duplicate_replay_key",
			},
			{
				index: 5,
				replay_key: staleReplayKey,
				reason: "timestamp_out_of_window",
			},
		]);
	});

	it("keeps event queue packet indexes tied to original packet order", () => {
		const result = canonicalAnalysis();
		const floodCluster = result.event_queue.groups
			.flatMap((group) => group.clusters)
			.find((cluster) => cluster.kind === "terrain_event:flood");

		expect(floodCluster?.packetIndexes).toEqual([0, 1]);
	});

	it("keeps identical coordinates as separate packet-index lineage", () => {
		const packets = [
			terrain({
				mac: "5C8AF3000A01",
				event: "flood",
				severity: 180,
				ts: 1759058400,
				...publicReferencePoint,
			}),
			terrain({
				mac: "5C8AF3000A02",
				event: "flood",
				severity: 190,
				ts: 1759058410,
				...publicReferencePoint,
			}),
		];
		const result = analyse(packets, "2026-09-23T14:40:00Z");
		const hazardRefs =
			result.alerts.find((alert) => alert.id === "packets_in_hazard_zone")
				?.refs ?? [];

		expect(result.overlays.map((overlay) => overlay.index)).toEqual([0, 1]);
		expect(hazardRefs).toEqual(["packets[0]", "packets[1]"]);
		expect(result.event_queue.groups[0]?.clusters[0]?.packetIndexes).toEqual([
			0, 1,
		]);
	});

	it("pins the canonical audit lineage fingerprint across derived outputs", () => {
		// This is a data-governance golden test, not a UI snapshot: performance
		// refactors must keep packet indexes, alert refs, cluster lineage, and
		// export row order byte-equivalent for the same packet batch.
		const result = canonicalAnalysis();
		const exportData = buildAgencyExport(result, "township");
		const csvRows = toAgencyCsv(exportData).split("\n");

		expect(result.summary).toEqual({
			village_counts: {
				"1003012": {
					unknown: 0,
					evacuated_shelter: 0,
					evacuated_relatives: 0,
					vertical_evacuated: 0,
					refused: 0,
					rescue_needed: "<5",
					self_evacuated_neighbor: 0,
					address_lost: 0,
				},
			},
			status_totals: {
				unknown: 0,
				evacuated_shelter: 0,
				evacuated_relatives: 0,
				vertical_evacuated: 0,
				refused: 0,
				rescue_needed: 2,
				self_evacuated_neighbor: 0,
				address_lost: 0,
			},
			flag_totals: {
				trapped: 2,
				injured: 0,
				long_term_care: 0,
				special_needs: 0,
				migrant_worker: 0,
				foreign_visitor: 0,
				requires_separated_space: 0,
				consent_refused: 0,
			},
			terrain_events: [
				{
					event: "flood",
					lat: 23.661234,
					lng: 121.421789,
					severity: 150,
					ts: 1759058400,
					flags: [],
				},
				{
					event: "flood",
					lat: 23.661234,
					lng: 121.421789,
					severity: 190,
					ts: 1759058410,
					flags: [],
				},
			],
			resource_offers: {
				vehicle_transport: 0,
				shelter_space: 0,
				power_generator: 0,
				medical_aid: 0,
				food_water: 0,
				communication: 0,
				fuel: 0,
				manpower: 0,
				warmth_supplies: 0,
				menstrual_supplies: 0,
			},
			resource_requests: {
				vehicle_transport: 0,
				shelter_space: 0,
				power_generator: 0,
				medical_aid: 0,
				food_water: 0,
				communication: 0,
				fuel: 0,
				manpower: 0,
				warmth_supplies: 11,
				menstrual_supplies: 0,
			},
			urgent_resource_requests: {
				vehicle_transport: 0,
				shelter_space: 0,
				power_generator: 0,
				medical_aid: 0,
				food_water: 0,
				communication: 0,
				fuel: 0,
				manpower: 0,
				warmth_supplies: 11,
				menstrual_supplies: 0,
			},
			packet_count: 4,
		});
		expect(
			result.overlays.map(
				({ index, type, zone, admin2, osm_tags_proposed }) => ({
					index,
					type,
					zoneId: zone.zoneId,
					inZone: zone.inZone,
					admin2,
					osm_tags_proposed,
				}),
			),
		).toEqual([
			{
				index: 0,
				type: "terrain_event",
				zoneId: "hualien-mataian-flood-demo",
				inZone: true,
				admin2: "Guangfu Township",
				osm_tags_proposed: "flood_prone=yes;practicability=no",
			},
			{
				index: 1,
				type: "terrain_event",
				zoneId: "hualien-mataian-flood-demo",
				inZone: true,
				admin2: "Guangfu Township",
				osm_tags_proposed: "flood_prone=yes;practicability=no",
			},
			{
				index: 2,
				type: "person_report",
				zoneId: "hualien-mataian-flood-demo",
				inZone: true,
				admin2: "Guangfu Township",
				osm_tags_proposed: undefined,
			},
			{
				index: 3,
				type: "resource_report",
				zoneId: "hualien-mataian-flood-demo",
				inZone: true,
				admin2: "Guangfu Township",
				osm_tags_proposed: undefined,
			},
		]);
		expect(
			result.alerts.map(({ id, severity, refs }) => ({ id, severity, refs })),
		).toEqual([
			{
				id: "rescue_needed",
				severity: "critical",
				refs: ["status_totals.rescue_needed"],
			},
			{
				id: "trapped",
				severity: "critical",
				refs: ["flag_totals.trapped"],
			},
			{
				id: "packets_in_hazard_zone",
				severity: "warning",
				refs: ["packets[0]", "packets[1]", "packets[2]", "packets[3]"],
			},
			{
				id: "urgent_warmth_supplies",
				severity: "warning",
				refs: ["urgent_resource_requests.warmth_supplies"],
			},
		]);
		expect(
			result.event_queue.groups.map((group) => ({
				adminAreaKey: group.adminAreaKey,
				totalPackets: group.totalPackets,
				highestSeverity: group.highestSeverity,
				latestTs: group.latestTs,
				clusters: group.clusters.map((cluster) => ({
					id: cluster.id,
					kind: cluster.kind,
					count: cluster.count,
					maxSeverity: cluster.maxSeverity,
					latestTs: cluster.latestTs,
					packetIndexes: cluster.packetIndexes,
				})),
			})),
		).toEqual([
			{
				adminAreaKey: "Hualien County/Guangfu Township",
				totalPackets: 4,
				highestSeverity: 220,
				latestTs: 1759058420,
				clusters: [
					{
						id: townshipClusterId("person_report:rescue_needed"),
						kind: "person_report:rescue_needed",
						count: 1,
						maxSeverity: 220,
						latestTs: 1759058420,
						packetIndexes: [2],
					},
					{
						id: townshipClusterId("terrain_event:flood"),
						kind: "terrain_event:flood",
						count: 2,
						maxSeverity: 190,
						latestTs: 1759058410,
						packetIndexes: [0, 1],
					},
					{
						id: townshipClusterId("resource_report:request"),
						kind: "resource_report:request",
						count: 1,
						maxSeverity: 170,
						latestTs: 1759058420,
						packetIndexes: [3],
					},
				],
			},
		]);
		expect(exportData.sections).toEqual([
			{
				id: "event_queue",
				title: "Event queue clusters",
				rows: [
					{
						area: "Hualien County/Guangfu Township",
						cluster_id: townshipClusterId("person_report:rescue_needed"),
						kind: "person_report:rescue_needed",
						status: "queued",
						count: 1,
						max_severity: 220,
						latest_ts: 1759058420,
						...roundedPublicReferencePoint,
						coord_resolution: 2,
					},
					{
						area: "Hualien County/Guangfu Township",
						cluster_id: townshipClusterId("terrain_event:flood"),
						kind: "terrain_event:flood",
						status: "queued",
						count: 2,
						max_severity: 190,
						latest_ts: 1759058410,
						...roundedPublicReferencePoint,
						coord_resolution: 2,
						osm_tags_proposed: "flood_prone=yes;practicability=no",
					},
					{
						area: "Hualien County/Guangfu Township",
						cluster_id: townshipClusterId("resource_report:request"),
						kind: "resource_report:request",
						status: "queued",
						count: 1,
						max_severity: 170,
						latest_ts: 1759058420,
						...roundedPublicReferencePoint,
						coord_resolution: 2,
					},
				],
			},
			{
				id: "alerts",
				title: "Alerts",
				rows: [
					{
						alert_id: "rescue_needed",
						severity: "critical",
						message: "<5 人需要救援",
						refs: "status_totals.rescue_needed",
					},
					{
						alert_id: "trapped",
						severity: "critical",
						message: "<5 人受困",
						refs: "flag_totals.trapped",
					},
					{
						alert_id: "packets_in_hazard_zone",
						severity: "warning",
						message: "4 筆通報落在已知災害區",
						refs: "packets[0]|packets[1]|packets[2]|packets[3]",
					},
					{
						alert_id: "urgent_warmth_supplies",
						severity: "warning",
						message: "11 份保暖物資 / 枕頭被毯緊急需求",
						refs: "urgent_resource_requests.warmth_supplies",
					},
				],
			},
			{
				id: "summary",
				title: "Aggregate summary",
				rows: [
					{ metric: "packet_count", value: 4 },
					{ metric: "village_count", value: 1 },
					{ metric: "terrain_event_count", value: 2 },
				],
			},
		]);
		expect(csvRows).toEqual([
			"\ufeffprofile,section,area,cluster_id,kind,status,count,max_severity,latest_ts",
			`township,event_queue,Hualien County/Guangfu Township,"${townshipClusterId("person_report:rescue_needed")}",person_report:rescue_needed,queued,1,220,1759058420`,
			`township,event_queue,Hualien County/Guangfu Township,"${townshipClusterId("terrain_event:flood")}",terrain_event:flood,queued,2,190,1759058410`,
			`township,event_queue,Hualien County/Guangfu Township,"${townshipClusterId("resource_report:request")}",resource_report:request,queued,1,170,1759058420`,
			"township,alerts,,,,,,,",
			"township,alerts,,,,,,,",
			"township,alerts,,,,,,,",
			"township,alerts,,,,,,,",
			"township,summary,,,packet_count,,4,,",
			"township,summary,,,village_count,,1,,",
			"township,summary,,,terrain_event_count,,2,,",
		]);
	});

	it("keeps cluster identity and packetIndexes tied to submitted order across reorder", () => {
		// Two disjoint admin areas: one inside the Guangfu bbox, one outside (unknown bucket).
		// Reordering unrelated groups must not change cluster ids or the index→packet linkage.
		const inside = terrain({
			event: "flood",
			severity: 150,
			ts: 1759058400,
			...publicReferencePoint,
		});
		const outside = terrain({
			event: "flood",
			severity: 200,
			ts: 1759058500,
			lat: 0.5,
			lng: 0.5,
		});
		const forward = analyse([inside, outside], "2026-09-23T14:40:00Z");
		const reversed = analyse([outside, inside], "2026-09-23T14:40:00Z");

		const idsOf = (result: AnalysisResult) =>
			new Set(
				result.event_queue.groups.flatMap((group) =>
					group.clusters.map((cluster) => cluster.id),
				),
			);
		expect(idsOf(forward)).toEqual(idsOf(reversed));

		const adminFor = (result: AnalysisResult, packetIndex: number) =>
			result.event_queue.groups.find((group) =>
				group.clusters.some((cluster) =>
					cluster.packetIndexes.includes(packetIndex),
				),
			)?.adminAreaKey;
		expect(adminFor(forward, 0)).toBe("Hualien County/Guangfu Township");
		expect(adminFor(forward, 1)).toMatch(/^unknown\//);
		expect(adminFor(reversed, 0)).toMatch(/^unknown\//);
		expect(adminFor(reversed, 1)).toBe("Hualien County/Guangfu Township");
	});

	it("orders event queue groups by compareGroups, not packet insertion order", () => {
		// Outside group carries higher severity, so it must lead regardless of input order.
		const lowInside = terrain({
			event: "flood",
			severity: 100,
			ts: 1759058400,
			...publicReferencePoint,
		});
		const highOutside = terrain({
			event: "flood",
			severity: 240,
			ts: 1759058500,
			lat: 0.5,
			lng: 0.5,
		});
		const groupKeys = (packets: PacketJson[]) =>
			analyse(packets, "2026-09-23T14:40:00Z").event_queue.groups.map(
				(group) => group.adminAreaKey,
			);

		expect(groupKeys([lowInside, highOutside])).toEqual(
			groupKeys([highOutside, lowInside]),
		);
		expect(groupKeys([lowInside, highOutside])[0]).toMatch(/^unknown\//);
	});

	it("keeps agency export rows traceable to analysis products", () => {
		const result = canonicalAnalysis();
		const exportData = buildAgencyExport(result, "township");
		const queueRows =
			exportData.sections.find((section) => section.id === "event_queue")
				?.rows ?? [];
		const alertRows =
			exportData.sections.find((section) => section.id === "alerts")?.rows ??
			[];
		const summaryRows =
			exportData.sections.find((section) => section.id === "summary")?.rows ??
			[];
		const clusterIds = new Set(
			result.event_queue.groups.flatMap((group) =>
				group.clusters.map((cluster) => cluster.id),
			),
		);
		const alertIds = new Set(result.alerts.map((alert) => alert.id));
		const summaryMetrics = new Set([
			"packet_count",
			"village_count",
			"terrain_event_count",
		]);

		expect(
			queueRows.every((row) => clusterIds.has(String(row.cluster_id))),
		).toBe(true);
		expect(alertRows.every((row) => alertIds.has(String(row.alert_id)))).toBe(
			true,
		);
		expect(
			alertRows.every((row) => alertRefsResolve(result, String(row.refs))),
		).toBe(true);
		expect(
			summaryRows.every((row) => summaryMetrics.has(String(row.metric))),
		).toBe(true);
	});
});
