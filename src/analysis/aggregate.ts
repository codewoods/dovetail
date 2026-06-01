import { match } from "ts-pattern";
import type {
	PacketJson,
	PersonFlag,
	PersonReportPacket,
	ResourceKind,
	ResourceReportPacket,
	TerrainEventPacket,
	TerrainFlag,
} from "../packet/types.ts";
import { type RestrictedCount, restrictedCount } from "./privacy.ts";

export interface PersonStatusCounts {
	unknown: RestrictedCount;
	evacuated_shelter: RestrictedCount;
	evacuated_relatives: RestrictedCount;
	vertical_evacuated: RestrictedCount;
	refused: RestrictedCount;
	rescue_needed: RestrictedCount;
	self_evacuated_neighbor: RestrictedCount;
	address_lost: RestrictedCount;
}

export interface ExactPersonStatusCounts {
	unknown: number;
	evacuated_shelter: number;
	evacuated_relatives: number;
	vertical_evacuated: number;
	refused: number;
	rescue_needed: number;
	self_evacuated_neighbor: number;
	address_lost: number;
}

interface AggregateSummaryShape<VillageCounts> {
	village_counts: VillageCounts;
	status_totals: ExactPersonStatusCounts;
	flag_totals: {
		trapped: number;
		injured: number;
		long_term_care: number;
		special_needs: number;
		migrant_worker: number;
		foreign_visitor: number;
		requires_separated_space: number;
		consent_refused: number;
	};
	terrain_events: Array<{
		event: string;
		lat: number;
		lng: number;
		severity: number;
		ts: number;
		flags: TerrainFlag[];
	}>;
	resource_offers: Record<ResourceKind, number>;
	resource_requests: Record<ResourceKind, number>;
	urgent_resource_requests: Record<ResourceKind, number>;
	packet_count: number;
}

export type AggregateSummary = AggregateSummaryShape<
	Record<string, PersonStatusCounts>
>;
type MutableAggregateSummary = AggregateSummaryShape<
	Record<string, ExactPersonStatusCounts>
>;

type TrackedPersonFlag = keyof AggregateSummary["flag_totals"];

// `flag in totals` only widens to `string` keys; the predicate re-narrows the flag
// to the tracked subset so the increment site stays index-safe without an `as` cast.
const isTrackedFlag = (
	flag: PersonFlag,
	totals: AggregateSummary["flag_totals"],
): flag is TrackedPersonFlag => flag in totals;

const emptyStatusCounts = (): ExactPersonStatusCounts => ({
	unknown: 0,
	evacuated_shelter: 0,
	evacuated_relatives: 0,
	vertical_evacuated: 0,
	refused: 0,
	rescue_needed: 0,
	self_evacuated_neighbor: 0,
	address_lost: 0,
});

const emptyResourceCounts = (): Record<ResourceKind, number> => ({
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
});

/**
 * Pure aggregation over a batch of decoded packets. The output is the canonical
 * input for the Mock 政府接收端 UI and a future read-only summary layer.
 * No I/O, no mutation of inputs, and no model calls in the critical path.
 */
export const aggregate = (packets: PacketJson[]): AggregateSummary => {
	const summary: MutableAggregateSummary = {
		village_counts: {},
		status_totals: emptyStatusCounts(),
		flag_totals: {
			trapped: 0,
			injured: 0,
			long_term_care: 0,
			special_needs: 0,
			migrant_worker: 0,
			foreign_visitor: 0,
			requires_separated_space: 0,
			consent_refused: 0,
		},
		terrain_events: [],
		resource_offers: emptyResourceCounts(),
		resource_requests: emptyResourceCounts(),
		urgent_resource_requests: emptyResourceCounts(),
		packet_count: packets.length,
	};

	for (const item of packets) {
		match(item)
			.with({ type: "person_report" }, (p) => foldPerson(summary, p.packet))
			.with({ type: "terrain_event" }, (p) => foldTerrain(summary, p.packet))
			.with({ type: "resource_report" }, (p) => foldResource(summary, p.packet))
			.exhaustive();
	}
	return {
		...summary,
		village_counts: restrictVillageCounts(summary.village_counts),
	};
};

/**
 * Village-level counts are more identifying than batch totals, so the public
 * summary buckets only the village map after all exact internal additions finish.
 */
const restrictVillageCounts = (
	counts: Record<string, ExactPersonStatusCounts>,
): Record<string, PersonStatusCounts> =>
	Object.fromEntries(
		Object.entries(counts).map(([village, statusCounts]) => [
			village,
			restrictStatusCounts(statusCounts),
		]),
	);

const restrictStatusCounts = (
	counts: ExactPersonStatusCounts,
): PersonStatusCounts => ({
	unknown: restrictedCount(counts.unknown),
	evacuated_shelter: restrictedCount(counts.evacuated_shelter),
	evacuated_relatives: restrictedCount(counts.evacuated_relatives),
	vertical_evacuated: restrictedCount(counts.vertical_evacuated),
	refused: restrictedCount(counts.refused),
	rescue_needed: restrictedCount(counts.rescue_needed),
	self_evacuated_neighbor: restrictedCount(counts.self_evacuated_neighbor),
	address_lost: restrictedCount(counts.address_lost),
});

const foldPerson = (
	summary: MutableAggregateSummary,
	packet: PersonReportPacket,
): void => {
	const key = String(packet.village);
	const village = summary.village_counts[key] ?? emptyStatusCounts();
	village[packet.status] += packet.count;
	summary.village_counts[key] = village;
	summary.status_totals[packet.status] += packet.count;
	const totals = summary.flag_totals;
	for (const flag of packet.flags) {
		if (isTrackedFlag(flag, totals)) totals[flag] += packet.count;
	}
};

const foldTerrain = (
	summary: MutableAggregateSummary,
	packet: TerrainEventPacket,
): void => {
	summary.terrain_events.push({
		event: packet.event,
		lat: packet.lat,
		lng: packet.lng,
		severity: packet.severity,
		ts: packet.ts,
		flags: packet.flags,
	});
};

const foldResource = (
	summary: MutableAggregateSummary,
	packet: ResourceReportPacket,
): void => {
	const target = packet.flags.includes("is_request")
		? summary.resource_requests
		: summary.resource_offers;
	for (const kind of packet.resource) target[kind] += packet.quantity;
	if (packet.flags.includes("is_request") && packet.flags.includes("urgent")) {
		for (const kind of packet.resource)
			summary.urgent_resource_requests[kind] += packet.quantity;
	}
};
