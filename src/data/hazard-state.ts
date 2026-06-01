export interface HazardState {
	areaId: string;
	rainfall: "normal" | "heavy" | "extreme";
	waterLevel: "normal" | "watch" | "danger";
	visibility: "normal" | "low";
	blockedRoads: string[];
	unsafeBridges: string[];
	updatedAt: string;
}

export const HAZARD_STATES: HazardState[] = [
	{
		areaId: "hualien-mataian-demo",
		rainfall: "extreme",
		waterLevel: "danger",
		visibility: "low",
		blockedRoads: ["riverbank-road-demo"],
		unsafeBridges: ["mataian-bridge-demo"],
		updatedAt: "2026-05-11T10:00:00Z",
	},
];
