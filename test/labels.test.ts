import { describe, expect, it } from "vitest";
import { LABELS, LABELS_BY_LOCALE, severityLabel } from "../src/demo/labels.ts";

describe("demo labels", () => {
	it("keeps zh-Hant-TW as the default labels", () => {
		expect(LABELS.status.rescue_needed).toBe("需要救援");
		expect(LABELS.queue.cluster_count).toBe("事件群組");
		expect(LABELS.queue.latest_time).toBe("最新回報");
		expect(LABELS.queue.highest_severity).toBe("最高顯示權重");
		expect(LABELS.queue.queued).toBe("優先檢視");
		expect(LABELS.severity_bands).toEqual(["低", "中", "高", "最高"]);
		expect(LABELS.severity_scale[2]).toMatchObject({
			label: "高",
			range: [128, 191],
		});
		expect(severityLabel(170)).toBe("高 · 128-191/255");
	});

	it("provides English labels for evaluator readability", () => {
		expect(LABELS_BY_LOCALE.en.status.rescue_needed).toBe("Rescue needed");
		expect(LABELS_BY_LOCALE.en.queue.event_queue).toBe("Event queue");
		expect(LABELS_BY_LOCALE["en-US"].queue.latest_time).toBe("Latest report");
		expect(LABELS_BY_LOCALE.en.queue.highest_severity).toBe(
			"Highest display weight",
		);
		expect(LABELS_BY_LOCALE.en.queue.queued).toBe("Review first");
		expect(LABELS_BY_LOCALE.en.resource.warmth_supplies).toBe(
			"Warmth supplies",
		);
		expect(LABELS_BY_LOCALE.en.severity_bands).toEqual([
			"Low",
			"Medium",
			"High",
			"Critical",
		]);
		expect(LABELS_BY_LOCALE.en.severity_scale[3]).toMatchObject({
			label: "Critical",
			range: [192, 255],
		});
	});
});
