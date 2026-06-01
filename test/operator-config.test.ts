import { describe, expect, it } from "vitest";
import queuePolicyJson from "../config/queue-policy.json";
import enLocaleJson from "../locales/en-US.json";
import zhTwLocaleJson from "../locales/zh-Hant-TW.json";
import { loadLocaleBundle } from "../src/config/locales.ts";
import {
	DEFAULT_QUEUE_POLICY,
	loadQueuePolicy,
} from "../src/config/queue-policy.ts";

describe("operator-editable config", () => {
	it("accepts a constrained queue policy without code changes", () => {
		const result = loadQueuePolicy({
			priorityOrder: [
				"person_report:rescue_needed",
				"terrain_event:flood",
				"resource_report:request",
			],
			queuedSeverityThreshold: 96,
			clusterRadiusDeg: 0.002,
			personStatusSeverity: { refused: 150, rescue_needed: 230 },
		});

		expect(result.warnings).toEqual([]);
		expect(result.policy.priorityOrder[1]).toBe("terrain_event:flood");
		expect(result.policy.queuedSeverityThreshold).toBe(96);
		expect(result.policy.personStatusSeverity.refused).toBe(150);
	});

	it("falls back to defaults for unsafe queue policy values", () => {
		const result = loadQueuePolicy({
			priorityOrder: ["terrain_event:flood", "javascript:alert"],
			queuedSeverityThreshold: 999,
			clusterRadiusDeg: -1,
			personStatusSeverity: { rescue_needed: "high" },
		});

		expect(result.policy.priorityOrder).toEqual(["terrain_event:flood"]);
		expect(result.policy.queuedSeverityThreshold).toBe(
			DEFAULT_QUEUE_POLICY.queuedSeverityThreshold,
		);
		expect(result.policy.clusterRadiusDeg).toBe(
			DEFAULT_QUEUE_POLICY.clusterRadiusDeg,
		);
		expect(result.policy.personStatusSeverity.rescue_needed).toBe(
			DEFAULT_QUEUE_POLICY.personStatusSeverity.rescue_needed,
		);
		expect(result.warnings).toContain(
			"priorityOrder[1] ignored: unknown queue kind",
		);
	});

	it("rejects incomplete locale edits without breaking defaults", () => {
		const result = loadLocaleBundle("en", {
			status: { rescue_needed: "Help" },
		});

		expect(result.locale).toBe("en");
		expect(result.labels.status.rescue_needed).toBe("Rescue needed");
		expect(result.warnings).toContain(
			"locale en ignored: missing section queue",
		);
	});

	it("ships valid operator-editable JSON files", () => {
		expect(loadQueuePolicy(queuePolicyJson).warnings).toEqual([]);
		expect(loadLocaleBundle("zh-Hant-TW", zhTwLocaleJson).warnings).toEqual([]);
		expect(loadLocaleBundle("en-US", enLocaleJson).warnings).toEqual([]);
	});
});
