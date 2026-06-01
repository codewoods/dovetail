export interface Coordinate {
	lat: number;
	lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

export const isValidLatLng = ({ lat, lng }: Coordinate): boolean =>
	Number.isFinite(lat) &&
	Number.isFinite(lng) &&
	lat >= -90 &&
	lat <= 90 &&
	lng >= -180 &&
	lng <= 180;

/**
 * Uses ray casting with explicit boundary detection so hazard-zone checks are deterministic.
 * Source coordinates follow GeoJSON order: [lng, lat].
 */
export function pointInPolygon(
	point: Coordinate,
	polygon: Array<[number, number]>,
): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const a = polygon[i];
		const b = polygon[j];
		if (!a || !b) continue;
		if (pointOnSegment(point, a, b)) return true;
		const intersects =
			a[1] > point.lat !== b[1] > point.lat &&
			point.lng < ((b[0] - a[0]) * (point.lat - a[1])) / (b[1] - a[1]) + a[0];
		if (intersects) inside = !inside;
	}
	return inside;
}

const pointOnSegment = (
	point: Coordinate,
	a: [number, number],
	b: [number, number],
): boolean => {
	const cross =
		(point.lat - a[1]) * (b[0] - a[0]) - (point.lng - a[0]) * (b[1] - a[1]);
	if (Math.abs(cross) > 1e-10) return false;
	const lenSq = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
	if (lenSq === 0) return point.lng === a[0] && point.lat === a[1];
	const dot =
		(point.lng - a[0]) * (b[0] - a[0]) + (point.lat - a[1]) * (b[1] - a[1]);
	return dot >= 0 && dot <= lenSq;
};

export function distanceMeters(from: Coordinate, to: Coordinate): number {
	const phi1 = toRad(from.lat);
	const phi2 = toRad(to.lat);
	const dPhi = toRad(to.lat - from.lat);
	const dLambda = toRad(to.lng - from.lng);
	const h =
		Math.sin(dPhi / 2) ** 2 +
		Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function bearingDegrees(from: Coordinate, to: Coordinate): number {
	const phi1 = toRad(from.lat);
	const phi2 = toRad(to.lat);
	const lambda1 = toRad(from.lng);
	const lambda2 = toRad(to.lng);
	const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
	const x =
		Math.cos(phi1) * Math.sin(phi2) -
		Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
	return Math.round((toDeg(Math.atan2(y, x)) + 360) % 360);
}

export function clockDirection(degrees: number): string {
	const hour = Math.round(degrees / 30) % 12 || 12;
	return `${hour}點鐘方向`;
}

const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
const toDeg = (radians: number): number => (radians * 180) / Math.PI;
