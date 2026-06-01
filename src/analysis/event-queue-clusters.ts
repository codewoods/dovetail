import { match } from "ts-pattern";
import type { QueuePolicy } from "../config/queue-policy.ts";
import type { PacketJson, PersonStatus } from "../packet/types.ts";
import type {
	EventCluster,
	EventQueueGroup,
	QueueItem,
	ReceiptState,
	TimeConfidence,
} from "./event-queue-types.ts";
import {
	buildSpatialFacts,
	type PacketSpatialFact,
	spatialFactAt,
} from "./spatial-facts.ts";

interface PacketQueueFacts {
	kind: string;
	severity: number;
}

type PriorityLookup = ReadonlyMap<string, number>;

/**
 * Convert packets into spatially attributed queue items, then group by admin area.
 * Spatial facts are supplied by index so geocode work is shared without changing
 * cluster identity or packet index lineage.
 */
export const buildGroups = (
	packets: readonly PacketJson[],
	policy: QueuePolicy,
	spatialFacts: readonly PacketSpatialFact[] = buildSpatialFacts(packets),
): EventQueueGroup[] => {
	const priorityLookup = buildPriorityLookup(policy);
	const items = packets.map((packet, index) =>
		toQueueItem(packet, index, policy, spatialFacts),
	);
	return Object.values(groupBy(items, (item) => item.adminAreaKey))
		.map((group) => buildGroup(group, policy, priorityLookup))
		.sort(compareGroups);
};

/** Create the queue item for one packet using its precomputed spatial fact. */
const toQueueItem = (
	packet: PacketJson,
	index: number,
	policy: QueuePolicy,
	spatialFacts: readonly PacketSpatialFact[],
): QueueItem => {
	const { geocode, point } = spatialFactAt(spatialFacts, packet, index);
	const adminAreaKey =
		geocode.admin1 && geocode.admin2
			? `${geocode.admin1}/${geocode.admin2}`
			: `unknown/${bucket(point.lat, point.lng)}`;
	const facts = packetQueueFacts(packet, policy);
	return {
		index,
		adminAreaKey,
		label: geocode.admin2 ?? "Unknown area",
		kind: facts.kind,
		lat: point.lat,
		lng: point.lng,
		ts: packet.packet.ts,
		severity: facts.severity,
		confidence: geocode.confidence,
		boundaryUncertain: geocode.boundaryUncertain,
	};
};

/** Resource requests and urgent resource requests sort above passive offers. */
const resourceSeverity = (
	packet: Extract<PacketJson, { type: "resource_report" }>,
): number =>
	packet.packet.flags.includes("urgent")
		? 170
		: packet.packet.flags.includes("is_request")
			? 120
			: 20;

const resourceKind = (
	packet: Extract<PacketJson, { type: "resource_report" }>,
): string => (packet.packet.flags.includes("is_request") ? "request" : "offer");

/** Packet classification happens once so kind labels and queue severity cannot drift. */
const packetQueueFacts = (
	packet: PacketJson,
	policy: QueuePolicy,
): PacketQueueFacts =>
	match(packet)
		.with({ type: "terrain_event" }, (p) => ({
			kind: `terrain_event:${p.packet.event}`,
			severity: p.packet.severity,
		}))
		.with({ type: "person_report" }, (p) => ({
			kind: `person_report:${p.packet.status}`,
			severity: personSeverity(p.packet.status, policy),
		}))
		.with({ type: "resource_report" }, (p) => ({
			kind: `resource_report:${resourceKind(p)}`,
			severity: resourceSeverity(p),
		}))
		.exhaustive();

const personSeverity = (status: PersonStatus, policy: QueuePolicy): number =>
	policy.personStatusSeverity[status];

const bucket = (lat: number, lng: number): string =>
	`${Math.round(lat * 100) / 100},${Math.round(lng * 100) / 100}`;

/** Build one admin-area queue group and apply final cluster display ordering only once. */
const buildGroup = (
	items: QueueItem[],
	policy: QueuePolicy,
	priorityLookup: PriorityLookup,
): EventQueueGroup => {
	const clusters = clusterItems(items, policy).sort((a, b) =>
		compareClusters(a, b, priorityLookup),
	);
	return {
		adminAreaKey: items[0]?.adminAreaKey ?? "unknown",
		label: items[0]?.label ?? "Unknown area",
		totalPackets: items.length,
		highestSeverity: Math.max(
			...clusters.map((cluster) => cluster.maxSeverity),
			0,
		),
		latestTs: Math.max(...clusters.map((cluster) => cluster.latestTs), 0),
		clusters,
	};
};

/**
 * Greedy clustering is enough for demo packet volumes and keeps behavior
 * explainable: only same-kind reports within a small location bucket merge.
 * The first matching cluster wins, which is deterministic because packets arrive
 * in batch order and sorting happens only after all clusters are built.
 */
const clusterItems = (
	items: readonly QueueItem[],
	policy: QueuePolicy,
): EventCluster[] => {
	const clusters: EventCluster[] = [];
	for (const item of items) {
		const matchIndex = clusters.findIndex(
			(cluster) =>
				cluster.kind === item.kind && isNear(cluster.centroid, item, policy),
		);
		if (matchIndex < 0) {
			clusters.push(clusterFrom(item, policy));
			continue;
		}
		clusters[matchIndex] = mergeCluster(clusters[matchIndex]!, item, policy);
	}
	return clusters;
};

const clusterFrom = (item: QueueItem, policy: QueuePolicy): EventCluster => ({
	id: `${item.adminAreaKey}:${item.kind}:${bucket(item.lat, item.lng)}`,
	kind: item.kind,
	status: item.severity >= policy.queuedSeverityThreshold ? "queued" : "watch",
	count: 1,
	maxSeverity: item.severity,
	latestTs: item.ts,
	confidence: item.confidence,
	receiptState:
		item.severity >= policy.queuedSeverityThreshold ? "queued" : "received",
	timeConfidence: timeConfidence(item.ts),
	boundaryUncertain: item.boundaryUncertain,
	centroid: { lat: item.lat, lng: item.lng },
	packetIndexes: [item.index],
});

const mergeCluster = (
	cluster: EventCluster,
	item: QueueItem,
	policy: QueuePolicy,
): EventCluster => ({
	...cluster,
	status:
		Math.max(cluster.maxSeverity, item.severity) >=
		policy.queuedSeverityThreshold
			? "queued"
			: "watch",
	count: cluster.count + 1,
	maxSeverity: Math.max(cluster.maxSeverity, item.severity),
	latestTs: Math.max(cluster.latestTs, item.ts),
	confidence: Math.min(cluster.confidence, item.confidence),
	receiptState: mergeReceiptState(cluster, item, policy),
	timeConfidence:
		cluster.timeConfidence === "stale_report_time" ||
		timeConfidence(item.ts) === "stale_report_time"
			? "stale_report_time"
			: "reported_time",
	boundaryUncertain: cluster.boundaryUncertain || item.boundaryUncertain,
	centroid: {
		lat: weightedMean(cluster.centroid.lat, cluster.count, item.lat),
		lng: weightedMean(cluster.centroid.lng, cluster.count, item.lng),
	},
	packetIndexes: [...cluster.packetIndexes, item.index],
});

const weightedMean = (current: number, count: number, next: number): number =>
	(current * count + next) / (count + 1);

const isNear = (
	centroid: EventCluster["centroid"],
	item: QueueItem,
	policy: QueuePolicy,
): boolean =>
	Math.abs(centroid.lat - item.lat) <= policy.clusterRadiusDeg &&
	Math.abs(centroid.lng - item.lng) <= policy.clusterRadiusDeg;

const compareClusters = (
	a: EventCluster,
	b: EventCluster,
	priorityLookup: PriorityLookup,
): number =>
	b.maxSeverity - a.maxSeverity ||
	priority(b.kind, priorityLookup) - priority(a.kind, priorityLookup) ||
	b.latestTs - a.latestTs ||
	b.confidence - a.confidence;

const compareGroups = (a: EventQueueGroup, b: EventQueueGroup): number =>
	b.highestSeverity - a.highestSeverity ||
	b.latestTs - a.latestTs ||
	a.adminAreaKey.localeCompare(b.adminAreaKey);

/** Precompute configured priority values once per queue build; first duplicate wins like indexOf(). */
const buildPriorityLookup = (policy: QueuePolicy): PriorityLookup => {
	const lookup = new Map<string, number>();
	policy.priorityOrder.forEach((kind, index) => {
		if (!lookup.has(kind)) lookup.set(kind, 1000 - index);
	});
	return lookup;
};

/** Resolve configured priority first, then deterministic fallback classes. */
const priority = (kind: string, priorityLookup: PriorityLookup): number => {
	const configuredPriority = priorityLookup.get(kind);
	if (configuredPriority !== undefined) return configuredPriority;
	if (
		kind.startsWith("person_report:rescue_needed") ||
		kind.startsWith("person_report:address_lost")
	)
		return 40;
	if (kind.startsWith("terrain_event:")) return 30;
	if (kind === "resource_report:request") return 20;
	return 10;
};

/**
 * Local Map.push avoids the O(n^2) spread-reducer allocation while keeping
 * iteration order stable: Map preserves first-insertion order of keys, and
 * within each bucket items stay in submitted order. `Object.fromEntries`
 * hands the caller the same `Record` shape so `Object.values(...)` downstream
 * still walks groups in insertion order, preserving cluster lineage.
 */
const groupBy = <T>(
	items: readonly T[],
	keyOf: (item: T) => string,
): Record<string, T[]> => {
	const buckets = new Map<string, T[]>();
	for (const item of items) {
		const key = keyOf(item);
		const bucket = buckets.get(key);
		if (bucket) bucket.push(item);
		else buckets.set(key, [item]);
	}
	return Object.fromEntries(buckets);
};

const timeConfidence = (ts: number): TimeConfidence =>
	ts < 946684800 ? "stale_report_time" : "reported_time";

const mergeReceiptState = (
	cluster: EventCluster,
	item: QueueItem,
	policy: QueuePolicy,
): ReceiptState =>
	cluster.receiptState === "review_hint"
		? "review_hint"
		: Math.max(cluster.maxSeverity, item.severity) >=
				policy.queuedSeverityThreshold
			? "queued"
			: "received";
