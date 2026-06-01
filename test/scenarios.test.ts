import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_SCENARIOS } from "../src/demo/scenarios.ts";

interface RawScenario {
	id: string;
	label: string;
	description: string;
	source: string;
	location_policy: string;
	occurred_at_utc: string;
	display_timezone: string;
	packets: Array<{
		packet_type: string;
		lat: number;
		lng: number;
		status?: string;
		resource?: string[];
		flags?: string[];
	}>;
}

const DEMO_PUBLIC_REFERENCE_COORDINATES = [
	"23.661234,121.421789",
	"23.641234,121.395678",
	"23.674322,121.424416",
] as const;

const readRawScenarios = (): RawScenario[] =>
	JSON.parse(readFileSync("src/demo/scenarios-data.json", "utf8"));

describe("demo scenarios", () => {
	it("keeps raw scenario data in a standalone JSON fixture", () => {
		expect(existsSync("src/demo/scenarios-data.json")).toBe(true);
		const raw = readRawScenarios();
		expect(raw.map((scenario) => scenario.id)).toEqual([
			"shelter-capacity-synthetic",
			"river-road-overlay-synthetic",
			"public-facility-resource-synthetic",
			"event-queue-cluster-synthetic",
		]);
		expect(raw[0]?.packets.length).toBeGreaterThan(0);
	});

	it("marks every scenario as synthetic data without real-case language", () => {
		const raw = readRawScenarios();
		const bannedText =
			/(長照戶|民宅|工地宿舍|真實事件|台北時間|洗腎者|獨居老人)/;

		for (const scenario of raw) {
			expect(scenario.source).toBe("Synthetic scenario");
			expect(scenario.location_policy).toBe("public_reference_coordinates");
			expect(scenario.occurred_at_utc).toMatch(/Z$/);
			expect(scenario.display_timezone).toBe("Asia/Taipei");
			expect(`${scenario.label} ${scenario.description}`).not.toMatch(
				bannedText,
			);
		}
	});

	it("keeps demo flags at aggregate-safe minimum for privacy review", () => {
		const raw = readRawScenarios();
		const flags = raw.flatMap((scenario) =>
			scenario.packets.flatMap((packet) => packet.flags ?? []),
		);

		expect(flags).not.toContain("long_term_care");
		expect(flags).not.toContain("migrant_worker");
		expect(flags).not.toContain("foreign_visitor");
		expect(flags).not.toContain("requires_separated_space");
		expect(flags).not.toContain("consent_acknowledged");
		expect(flags).not.toContain("consent_refused");
	});

	it("uses only reviewed public reference coordinates in demo scenarios", () => {
		const allowed = new Set<string>(DEMO_PUBLIC_REFERENCE_COORDINATES);
		const raw = readRawScenarios();
		const coordinates = raw.flatMap((scenario) =>
			scenario.packets.map((packet) => `${packet.lat},${packet.lng}`),
		);

		expect(coordinates.length).toBeGreaterThan(0);
		expect(coordinates.every((coordinate) => allowed.has(coordinate))).toBe(
			true,
		);
	});

	it("keeps river-road scenario focused on evacuation state, not power or comms", () => {
		const raw = readRawScenarios();
		const scenario = raw.find(
			(item) => item.id === "river-road-overlay-synthetic",
		);
		if (!scenario) throw new Error("Missing river-road demo scenario");
		const resources = scenario.packets.flatMap(
			(packet) => packet.resource ?? [],
		);
		const statuses = scenario.packets.flatMap((packet) =>
			packet.status ? [packet.status] : [],
		);

		expect(resources).not.toContain("communication");
		expect(resources).not.toContain("power_generator");
		expect(statuses).toContain("evacuated_shelter");
		expect(scenario.description).toContain("撤離");
	});

	it("uses deterministic timestamps for reproducible demo fixtures", () => {
		const packet = DEMO_SCENARIOS[0]!.packets[0]!;
		expect(packet.packet.ts).toBeGreaterThanOrEqual(1758610200);
		expect(packet.packet.ts).toBeLessThan(1758610800);
	});
});
