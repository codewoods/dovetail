export interface DemoShelter {
	readonly id: string;
	readonly name: string;
	readonly township: string;
	readonly village: string;
	readonly lat: number;
	readonly lng: number;
	readonly capacity: number;
	readonly supports_vulnerable: boolean;
	readonly facilities: readonly string[];
}

export const DEMO_SHELTERS: readonly DemoShelter[] = [] as const;
