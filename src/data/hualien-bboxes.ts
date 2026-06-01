export type Scenario = "local_hazard" | "unknown";

export interface HualienBbox {
	id: string;
	bbox: [number, number, number, number];
	country: "TW";
	admin1: string;
	admin2: string;
	placeName: string;
}

export const HUALIEN_BBOXES: HualienBbox[] = [
	{
		id: "hualien-mataian-demo",
		bbox: [121.39, 23.62, 121.46, 23.71],
		country: "TW",
		admin1: "Hualien County",
		admin2: "Guangfu Township",
		placeName: "Matai'an Creek area",
	},
];
