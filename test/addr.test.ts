import { describe, expect, it } from "vitest";
import { ADDR_SIZE, decodeAddr, encodeAddr } from "../src/packet/addr.ts";

describe("addr encoding boundary", () => {
	it("round-trips an ASCII TGOS label", () => {
		const bytes = encodeAddr("CN5630");
		expect(bytes.length).toBe(ADDR_SIZE);
		expect(bytes[0]).toBe(0x00);
		expect(decodeAddr(bytes)).toBe("CN5630");
	});

	it("round-trips a dictionary tag without payload bytes", () => {
		const bytes = encodeAddr("WORKSITE");
		expect(bytes[0]).toBe(0x33);
		expect(decodeAddr(bytes)).toBe("WORKSITE");
	});

	it("rejects non-ASCII TGOS labels (would otherwise UTF-8 truncate)", () => {
		expect(() => encodeAddr("台北市信義路")).toThrow(RangeError);
	});

	it("rejects TGOS labels exceeding the 6-byte payload window", () => {
		expect(() => encodeAddr("ABCDEFG")).toThrow(RangeError);
	});
});
