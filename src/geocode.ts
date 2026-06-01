import { HUALIEN_BBOXES, type Scenario } from "./data/hualien-bboxes.ts";
import type { Coordinate } from "./geo-math.ts";

export interface GeocodeResult {
	country?: "TW";
	admin1?: string;
	admin2?: string;
	placeName?: string;
	scenario: Scenario;
	method: "bbox" | "unknown";
	confidence: number;
	boundaryUncertain: boolean;
}

const contains = (
	[minLng, minLat, maxLng, maxLat]: [number, number, number, number],
	p: Coordinate,
) => p.lng >= minLng && p.lng <= maxLng && p.lat >= minLat && p.lat <= maxLat;

/**
 * Hualien-only demo geocoder. Locations outside the supported disaster area are conservative
 * unknowns because the cross-country advisory product has been removed.
 */
export function reverseGeocode(point: Coordinate): GeocodeResult {
	const match = HUALIEN_BBOXES.find((box) => contains(box.bbox, point));
	if (!match)
		return {
			scenario: "unknown",
			method: "unknown",
			confidence: 0.3,
			boundaryUncertain: false,
		};
	return {
		country: match.country,
		admin1: match.admin1,
		admin2: match.admin2,
		placeName: match.placeName,
		scenario: "local_hazard",
		method: "bbox",
		confidence: 0.8,
		boundaryUncertain: nearBoundary(match.bbox, point),
	};
}

const nearBoundary = (
	[minLng, minLat, maxLng, maxLat]: [number, number, number, number],
	point: Coordinate,
): boolean => {
	const margin = 0.001;
	return (
		point.lng - minLng <= margin ||
		maxLng - point.lng <= margin ||
		point.lat - minLat <= margin ||
		maxLat - point.lat <= margin
	);
};
