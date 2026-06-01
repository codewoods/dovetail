import type { Scenario } from "./hualien-bboxes.ts";

export type ZoneType = "flood" | "landslide" | "river_corridor" | "unknown";

export interface HazardZone {
	id: string;
	name: string;
	zoneType: Exclude<ZoneType, "unknown">;
	scenario: Exclude<Scenario, "unknown">;
	source: "demo_geojson" | "moa_open_data_shp";
	active: boolean;
	freshness: "demo" | "static";
	stateAreaId: string;
	coordinates: Array<[number, number]>;
	provenance: {
		score: number;
		basis: string[];
	};
}

export const HAZARD_ZONES: HazardZone[] = [
	{
		id: "hualien-mataian-flood-demo",
		name: "馬太鞍溪堰塞湖影響區",
		zoneType: "river_corridor",
		scenario: "local_hazard",
		source: "demo_geojson",
		active: true,
		freshness: "demo",
		stateAreaId: "hualien-mataian-demo",
		provenance: {
			score: 0.62,
			basis: ["demo event boundary", "rainfall_state_demo"],
		},
		coordinates: [
			[121.41, 23.65],
			[121.43, 23.65],
			[121.43, 23.68],
			[121.41, 23.68],
			[121.41, 23.65],
		],
	},
	{
		id: "hualien-guangfu-dama-df110",
		name: "光復鄉大馬村土石流影響範圍 DF110",
		zoneType: "landslide",
		scenario: "local_hazard",
		source: "moa_open_data_shp",
		active: true,
		freshness: "static",
		stateAreaId: "hualien-mataian-demo",
		provenance: {
			score: 0.78,
			basis: [
				"MOA open data SHP",
				"redacted address fields",
				"DuckDB ST_Within validation target",
			],
		},
		coordinates: [
			[121.418290365565, 23.675563464738],
			[121.418789522165, 23.676124672305],
			[121.4188699062, 23.676244280331],
			[121.418993091101, 23.676319345975],
			[121.419150174698, 23.676325332189],
			[121.419259388386, 23.6762620087],
			[121.419374932963, 23.676154873503],
			[121.419463357311, 23.676028849091],
			[121.419538190922, 23.675883808573],
			[121.419612730822, 23.675738949408],
			[121.419666875645, 23.675562721779],
			[121.419673198425, 23.675424277922],
			[121.419611184225, 23.675254595492],
			[121.419501883732, 23.675198274696],
			[121.419336257781, 23.675187887347],
			[121.419133173587, 23.675237017211],
			[121.418809569132, 23.675308595667],
			[121.418492578238, 23.67542512396],
			[121.418290365565, 23.675563464738],
		],
	},
];
