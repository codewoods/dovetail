import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	APCA_LC_TARGET,
	apcaLc,
	auditContrast,
	DEMO_COLORS,
	DEMO_READABLE_COMBOS,
	formatContrastAudit,
} from "../src/contrast/apca.ts";

const DEMO_CSS = readFileSync(
	new URL("../src/demo/demo.css", import.meta.url),
	"utf8",
);

describe("APCA contrast", () => {
	it("returns signed Lc values for APCA polarity", () => {
		expect(apcaLc("#e2e8f0", "#0f172a")).toBeLessThan(-90);
		expect(apcaLc("#0f172a", "#e2e8f0")).toBeGreaterThan(90);
	});

	it("keeps readable demo color pairs at APCA Lc70 or above", () => {
		const failures = auditContrast(DEMO_READABLE_COMBOS);
		expect(failures).toEqual([]);
	});

	it("audits the same demo palette tokens used by CSS", () => {
		for (const [token, color] of Object.entries(DEMO_COLORS)) {
			expect(DEMO_CSS).toContain(`--${token}: ${color};`);
		}
	});

	it("formats a CLI audit for local and CI verification", () => {
		const failures = auditContrast(DEMO_READABLE_COMBOS, APCA_LC_TARGET);
		const output = `${formatContrastAudit(DEMO_READABLE_COMBOS, APCA_LC_TARGET)}\n\n${failures.length} failure(s) at Lc70 target.`;

		expect(output).toContain("0 failure(s) at Lc70 target.");
		expect(output).toContain("[ OK ]");
	});
});
