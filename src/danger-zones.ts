import {
	HAZARD_ZONES,
	type HazardZone,
	type ZoneType,
} from "./data/hazard-zones.ts";
import type { Scenario } from "./data/hualien-bboxes.ts";
import { type Coordinate, pointInPolygon } from "./geo-math.ts";

export interface DangerZoneResult {
	inZone: boolean;
	zoneId?: string;
	zoneName?: string;
	zoneType?: ZoneType;
	source?: string;
	freshness?: "demo" | "static" | "recent" | "stale";
	provenanceScore?: number;
	stateAreaId?: string;
	confidence: number;
}

interface ZoneBbox {
	readonly minLng: number;
	readonly minLat: number;
	readonly maxLng: number;
	readonly maxLat: number;
}

interface HazardZoneCandidate {
	readonly zone: HazardZone;
	readonly bbox: ZoneBbox;
}

const HAZARD_ZONE_CANDIDATES: readonly HazardZoneCandidate[] = HAZARD_ZONES.map(
	(zone) => ({ zone, bbox: polygonBbox(zone.coordinates) }),
);

/**
 * Checks active Hualien hazard polygons only. Demo layers cap confidence, while official static
 * boundaries can carry higher provenance but still do not imply live passability.
 */
export function checkDangerZone(
	point: Coordinate,
	scenario: Scenario,
): DangerZoneResult {
	for (const candidate of HAZARD_ZONE_CANDIDATES) {
		const { zone } = candidate;
		if (!zone.active || zone.scenario !== scenario) continue;
		if (!candidateBboxContains(candidate, point)) continue;
		if (pointInPolygon(point, zone.coordinates)) return zoneResult(zone);
	}
	return { inZone: false, confidence: scenario === "unknown" ? 0.3 : 0.7 };
}

/**
 * Precompute a polygon bbox once so lookup can reject impossible candidates
 * before point-in-polygon. Coordinate order stays GeoJSON-style [lng, lat].
 */
function polygonBbox(coordinates: readonly [number, number][]): ZoneBbox {
	let minLng = Number.POSITIVE_INFINITY;
	let minLat = Number.POSITIVE_INFINITY;
	let maxLng = Number.NEGATIVE_INFINITY;
	let maxLat = Number.NEGATIVE_INFINITY;
	for (const [lng, lat] of coordinates) {
		minLng = Math.min(minLng, lng);
		minLat = Math.min(minLat, lat);
		maxLng = Math.max(maxLng, lng);
		maxLat = Math.max(maxLat, lat);
	}
	return { minLng, minLat, maxLng, maxLat };
}

const candidateBboxContains = (
	{ bbox }: HazardZoneCandidate,
	point: Coordinate,
): boolean =>
	point.lng >= bbox.minLng &&
	point.lng <= bbox.maxLng &&
	point.lat >= bbox.minLat &&
	point.lat <= bbox.maxLat;

const zoneResult = (zone: HazardZone): DangerZoneResult => ({
	inZone: true,
	zoneId: zone.id,
	zoneName: zone.name,
	zoneType: zone.zoneType,
	source: zone.source,
	freshness: zone.freshness,
	provenanceScore: zone.provenance.score,
	stateAreaId: zone.stateAreaId,
	confidence:
		zone.freshness === "demo" ? 0.75 : Math.min(0.82, zone.provenance.score),
});
