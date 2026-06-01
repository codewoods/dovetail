import { OPERATOR_QUEUE_POLICY } from "../config/queue-policy.ts";
import { checkDangerZone } from "../danger-zones.ts";
import { isValidLatLng } from "../geo-math.ts";
import { reverseGeocode } from "../geocode.ts";
import type { PacketJson } from "../packet/types.ts";
import {
	MAX_PACKET_BODY_BYTES,
	validatePacketBatch,
} from "../packet/validate.ts";
import { type AggregateSummary, aggregate } from "./aggregate.ts";
import { type Alert, deriveAlerts } from "./alerts.ts";
import { buildEventQueue, type EventQueue } from "./event-queue.ts";
import { overlay, type PacketOverlay } from "./overlay.ts";
import { filterReplays, type RejectedPacket } from "./replay.ts";
import { buildSpatialFacts } from "./spatial-facts.ts";

const textEncoder = new TextEncoder();

export interface AnalysisResult {
	summary: AggregateSummary;
	overlays: PacketOverlay[];
	alerts: Alert[];
	event_queue: EventQueue;
	semantic_verification: SemanticVerification;
	analysed_at: string;
}

export type SemanticVerification = "field_observation_unverified_truth";

/**
 * Pure orchestrator: packets → aggregate + overlay + rule-based fact triggers. The HTTP
 * handler in src/index.ts is the only place that touches Request/Response; this
 * keeps the analysis path testable without spinning a Worker.
 */
export const analyse = (
	packets: PacketJson[],
	nowIso = new Date().toISOString(),
): AnalysisResult => {
	const summary = aggregate(packets);
	const spatialFacts = buildSpatialFacts(packets);
	const overlays = overlay(packets, spatialFacts);
	const alerts = deriveAlerts(summary, overlays);
	const event_queue = buildEventQueue(
		packets,
		OPERATOR_QUEUE_POLICY,
		spatialFacts,
	);
	return {
		summary,
		overlays,
		alerts,
		event_queue,
		semantic_verification: "field_observation_unverified_truth",
		analysed_at: nowIso,
	};
};

export interface IngressAnalysisResult extends AnalysisResult {
	rejected: RejectedPacket[];
}

export interface PartitionedIngressPackets {
	readonly accepted: PacketJson[];
	readonly rejected: RejectedPacket[];
}

/**
 * Partition ingress packets once so the caller can preserve rejected audit rows
 * while only forwarding accepted packets into gateway stateful checks.
 */
export const partitionIngressPackets = (
	packets: PacketJson[],
): Promise<PartitionedIngressPackets> => filterReplays(packets);

/**
 * /api/packets boundary wrapper per spec §8.1.1. Applies deterministic replay
 * rejection (duplicate JSON replay key + envelope.received_at vs packet.ts window) before
 * delegating to the pure analyse() pipeline so aggregate counters cannot be
 * inflated by replayed or out-of-window packets. The rejected list is surfaced
 * verbatim for audit.
 */
export const analyseAtIngress = async (
	packets: PacketJson[],
	nowIso = new Date().toISOString(),
): Promise<IngressAnalysisResult> => {
	const { accepted, rejected } = await partitionIngressPackets(packets);
	return { ...analyse(accepted, nowIso), rejected };
};

export interface HazardZoneQueryInput {
	lat: number;
	lng: number;
}

export interface HazardZoneQueryResult {
	input: HazardZoneQueryInput;
	scenario: ReturnType<typeof reverseGeocode>["scenario"];
	location: {
		admin1?: string;
		admin2?: string;
		place_name?: string;
		method: ReturnType<typeof reverseGeocode>["method"];
		confidence: number;
	};
	zone: ReturnType<typeof checkDangerZone>;
}

/**
 * Static-only hazard-zone lookup: bbox geocode + point-in-polygon over hazard zones loaded
 * by the GDAL pipeline. Self-rescue advice was removed in the codebase pivot —
 * analysis-component only states "are you in a known zone", not "what to do next".
 */
export const queryHazardZone = (
	input: HazardZoneQueryInput,
): HazardZoneQueryResult | null => {
	if (!isValidLatLng(input)) return null;
	const geocode = reverseGeocode(input);
	const zone = checkDangerZone(input, geocode.scenario);
	return {
		input,
		scenario: geocode.scenario,
		location: {
			...(geocode.admin1 === undefined ? {} : { admin1: geocode.admin1 }),
			...(geocode.admin2 === undefined ? {} : { admin2: geocode.admin2 }),
			...(geocode.placeName === undefined
				? {}
				: { place_name: geocode.placeName }),
			method: geocode.method,
			confidence: geocode.confidence,
		},
		zone,
	};
};

/** Parse and validate packet JSON after enforcing the offline body-size budget. */
export const parsePacketBatch = (
	raw: string,
): { ok: true; packets: PacketJson[] } | { ok: false; error: string } => {
	const rawBytes = textEncoder.encode(raw);
	if (rawBytes.length > MAX_PACKET_BODY_BYTES)
		return { ok: false, error: "body_too_large" };
	try {
		const data = JSON.parse(raw) as unknown;
		return validatePacketBatch(data);
	} catch {
		return { ok: false, error: "invalid_json" };
	}
};
