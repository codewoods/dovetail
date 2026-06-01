import { checkDangerZone, type DangerZoneResult } from "../danger-zones.ts";
import type { Coordinate } from "../geo-math.ts";
import { type GeocodeResult, reverseGeocode } from "../geocode.ts";
import type { PacketJson } from "../packet/types.ts";

export interface PacketSpatialFact {
	readonly index: number;
	readonly point: Coordinate;
	readonly geocode: GeocodeResult;
	readonly zone: DangerZoneResult;
}

export const packetPoint = (packet: PacketJson): Coordinate => ({
	lat: packet.packet.lat,
	lng: packet.packet.lng,
});

/**
 * Build spatial facts once per accepted packet batch. The array position and
 * explicit `index` are the lineage keys; coordinates are copied facts, never an
 * identity for dedupe or joins, so identical points remain distinct packets.
 */
export const buildSpatialFacts = (
	packets: readonly PacketJson[],
): PacketSpatialFact[] =>
	packets.map((packet, index) => {
		const point = packetPoint(packet);
		const geocode = reverseGeocode(point);
		const zone = checkDangerZone(point, geocode.scenario);
		return { index, point, geocode, zone };
	});

/**
 * Read a fact by original packet index and fail closed on stale or mismatched
 * fact arrays. Coordinate comparison only validates caller alignment; it does
 * not merge or identify records, preserving same-coordinate multi-packet lineage.
 */
export const spatialFactAt = (
	facts: readonly PacketSpatialFact[],
	packet: PacketJson,
	index: number,
): PacketSpatialFact => {
	const fact = facts[index];
	if (
		fact === undefined ||
		fact.index !== index ||
		fact.point.lat !== packet.packet.lat ||
		fact.point.lng !== packet.packet.lng
	)
		throw new Error(`Spatial fact missing or stale for packet index ${index}`);
	return fact;
};
