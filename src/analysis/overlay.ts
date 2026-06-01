import type { DangerZoneResult } from "../danger-zones.ts";
import type { PacketJson } from "../packet/types.ts";
import { osmTagsForTerrainEvent } from "./interoperability.ts";
import {
	buildSpatialFacts,
	type PacketSpatialFact,
	spatialFactAt,
} from "./spatial-facts.ts";

export interface PacketOverlay {
	index: number;
	type: PacketJson["type"];
	lat: number;
	lng: number;
	ts: number;
	zone: DangerZoneResult;
	admin2?: string;
	osm_tags_proposed?: string;
}

/**
 * Each decoded packet carries a GNSS point; overlay maps the point onto the static
 * hazard zones produced by GDAL pipeline (docs/developer/gdal-pipeline.md). Bucketing decisions
 * (e.g. "all packets inside debris-flow polygon X") stay deterministic so audit trail
 * can be reproduced from the same packet batch + zone table.
 */
export const overlay = (
	packets: PacketJson[],
	spatialFacts: readonly PacketSpatialFact[] = buildSpatialFacts(packets),
): PacketOverlay[] =>
	packets.map((item, index) => {
		const { point, geocode, zone } = spatialFactAt(spatialFacts, item, index);
		const admin2 =
			geocode.admin2 === undefined ? {} : { admin2: geocode.admin2 };
		const osmTags = osmTagsForPacket(item);
		return {
			index,
			type: item.type,
			lat: point.lat,
			lng: point.lng,
			ts: item.packet.ts,
			zone,
			...admin2,
			...osmTags,
		};
	});

const osmTagsForPacket = (item: PacketJson): { osm_tags_proposed?: string } => {
	if (item.type !== "terrain_event") return {};
	const tags = osmTagsForTerrainEvent(item.packet.event, item.packet.severity);
	return tags === undefined ? {} : { osm_tags_proposed: tags };
};
