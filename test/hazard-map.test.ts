import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

class TestSvgNode {
	readonly children: TestSvgNode[] = [];
	readonly attrs = new Map<string, string>();
	textContent = "";

	constructor(readonly tagName: string) {}

	get firstChild(): TestSvgNode | undefined {
		return this.children[0];
	}

	appendChild(node: TestSvgNode): TestSvgNode {
		this.children.push(node);
		return node;
	}

	removeChild(node: TestSvgNode): TestSvgNode {
		const index = this.children.indexOf(node);
		if (index >= 0) this.children.splice(index, 1);
		return node;
	}

	setAttribute(key: string, value: string): void {
		this.attrs.set(key, value);
	}

	getAttribute(key: string): string | undefined {
		return this.attrs.get(key);
	}
}

type RenderHazardMap = (input: {
	svg: TestSvgNode;
	summaryNode: TestSvgNode;
	hazardZones: Array<{
		zoneType: string;
		coordinates: Array<[number, number]>;
		label?: string;
	}>;
	shelters?: Array<{
		id: string;
		name: string;
		lat: number;
		lng: number;
		capacity: number;
		supports_vulnerable: boolean;
	}>;
	packets: Array<{
		type: string;
		packet: { lat: number; lng: number };
	}>;
	analysis: {
		overlays: Array<{ index: number; zone: { inZone: boolean } }>;
	} | null;
	visible: boolean;
	opacity: number;
}) => void;

const installSvgDocument = (): void => {
	(globalThis as unknown as { document: unknown }).document = {
		createElementNS: (_namespace: string, tagName: string) =>
			new TestSvgNode(tagName),
	};
};

const renderModule = async (): Promise<{
	renderHazardMap: RenderHazardMap;
}> => {
	const url = pathToFileURL(`${process.cwd()}/src/demo/hazard-map.js`).href;
	return (await import(url)) as { renderHazardMap: RenderHazardMap };
};

const walk = (node: TestSvgNode): TestSvgNode[] => [
	node,
	...node.children.flatMap(walk),
];

const mapPoints = (svg: TestSvgNode): TestSvgNode[] =>
	walk(svg).filter((node) =>
		node.getAttribute("class")?.startsWith("map-point"),
	);

const shelterPoints = (svg: TestSvgNode): TestSvgNode[] =>
	walk(svg).filter((node) =>
		node.getAttribute("class")?.startsWith("shelter-point"),
	);

const titleOf = (node: TestSvgNode): string | undefined =>
	node.children.find((child) => child.tagName === "title")?.textContent;

describe("hazard map rendering", () => {
	it("uses an overlay index map instead of per-marker overlay scans", () => {
		const source = readFileSync("src/demo/hazard-map.js", "utf8");

		expect(source).toContain("buildOverlayLookup");
		expect(source).not.toContain(".find((overlay) => overlay.index === index)");
	});

	it("matches shuffled overlays to packet markers by overlay.index", async () => {
		installSvgDocument();
		const { renderHazardMap } = await renderModule();
		const svg = new TestSvgNode("svg");
		const summaryNode = new TestSvgNode("div");

		renderHazardMap({
			svg,
			summaryNode,
			hazardZones: [
				{
					zoneType: "river_corridor",
					coordinates: [
						[0.2, 0.1],
						[0.3, 0.1],
						[0.3, 0.2],
						[0.2, 0.2],
					],
				},
			],
			shelters: [
				{
					id: "TEST-SHELTER-001",
					name: "Test Shelter Alpha",
					lat: 0.15,
					lng: 0.25,
					capacity: 102,
					supports_vulnerable: true,
				},
			],
			packets: [
				{ type: "person_report", packet: { lat: 0.16, lng: 0.28 } },
				{ type: "terrain_event", packet: { lat: 0.18, lng: 0.24 } },
			],
			analysis: {
				overlays: [
					{ index: 1, zone: { inZone: true } },
					{ index: 0, zone: { inZone: false } },
				],
			},
			visible: true,
			opacity: 0.72,
		});

		const points = mapPoints(svg);
		const shelters = shelterPoints(svg);
		expect(summaryNode.textContent).toBe(
			"1/2 筆落在 hazard overlay · 1 shelters",
		);
		expect(shelters.map(titleOf)).toEqual([
			"shelter TEST-SHELTER-001: Test Shelter Alpha, capacity 102",
		]);
		expect(points.map((point) => point.getAttribute("class"))).toEqual([
			"map-point person-report",
			"map-point terrain-event in-zone",
		]);
		expect(points.map(titleOf)).toEqual(["packet 0", "packet 1: hazard hit"]);
	});
});
