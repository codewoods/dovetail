import {
	DEFAULT_QUEUE_POLICY,
	type QueuePolicy,
} from "../config/queue-policy.ts";
import type { PacketJson } from "../packet/types.ts";
import { buildGroups } from "./event-queue-clusters.ts";
import { deriveHints } from "./event-queue-hints.ts";
import type {
	EventCluster,
	EventQueue,
	EventQueueGroup,
	QueueHint,
} from "./event-queue-types.ts";
import { buildSpatialFacts, type PacketSpatialFact } from "./spatial-facts.ts";

/**
 * Derive the receiving-side queue from decoded packets. The queue is deliberately
 * presentation-oriented: it buckets by administrative area, clusters nearby
 * same-kind reports, and sorts by display weight before the UI sees it.
 * It stays pure so HTTP, tests, and future CLI integrations can reuse the same
 * ordering without depending on a browser or a database.
 */
export const buildEventQueue = (
	packets: PacketJson[],
	policy: QueuePolicy = DEFAULT_QUEUE_POLICY,
	spatialFacts: readonly PacketSpatialFact[] = buildSpatialFacts(packets),
): EventQueue => {
	const groups = buildGroups(packets, policy, spatialFacts);
	return { totalPackets: packets.length, groups, hints: deriveHints(groups) };
};

export type { EventCluster, EventQueue, EventQueueGroup, QueueHint };
