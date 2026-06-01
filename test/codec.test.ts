import { describe, expect, it } from "vitest";
import {
	buildNonce,
	decodePersonReport,
	decodeResourceReport,
	decodeTerrainEvent,
	encodePersonReport,
	encodeResourceReport,
	encodeTerrainEvent,
	keyFromHex,
	PERSON_REPORT_SIZE,
	RESOURCE_REPORT_SIZE,
	TERRAIN_EVENT_SIZE,
	TYPE_PERSON_REPORT,
	TYPE_RESOURCE_REPORT,
	TYPE_TERRAIN_EVENT,
} from "../src/packet/codec.ts";

const DEMO_KEY_HEX = "00112233445566778899aabbccddeeff";
const MAC_HEX = "5C8AF3000001";
const MAC_BYTES = Uint8Array.from([0x5c, 0x8a, 0xf3, 0x00, 0x00, 0x01]);

const expectInvalidCounterEncode = async <Packet>(
	encode: (
		packet: Packet,
		key: CryptoKey,
		counter: number,
	) => Promise<Uint8Array>,
	packet: Packet,
): Promise<void> => {
	const key = await keyFromHex(DEMO_KEY_HEX);
	await expect(encode(packet, key, 1.5)).rejects.toThrow(RangeError);
};

describe("packet codec / person_report", () => {
	it("round-trips through AES-128-GCM and matches SPEC byte budget", async () => {
		const key = await keyFromHex(DEMO_KEY_HEX);
		const frame = await encodePersonReport(
			{
				mac: MAC_HEX,
				village: 1003012,
				ts: 1759058400,
				lat: 12.34,
				lng: 56.78,
				alt: 142,
				addr: "CN5630",
				count: 3,
				status: "evacuated_shelter",
				flags: ["special_needs", "long_term_care", "on_site"],
			},
			key,
			1,
		);

		expect(frame.length).toBe(PERSON_REPORT_SIZE);
		expect(frame[0]).toBe(0x01);

		const decoded = await decodePersonReport(frame, key, 1, MAC_BYTES);
		expect(decoded.mac).toBe(MAC_HEX);
		expect(decoded.village).toBe(1003012);
		expect(decoded.ts).toBe(1759058400);
		expect(decoded.lat).toBeCloseTo(12.34, 5);
		expect(decoded.lng).toBeCloseTo(56.78, 5);
		expect(decoded.alt).toBe(142);
		expect(decoded.addr).toBe("CN5630");
		expect(decoded.count).toBe(3);
		expect(decoded.status).toBe("evacuated_shelter");
		expect(decoded.flags.sort()).toEqual([
			"long_term_care",
			"on_site",
			"special_needs",
		]);
	});

	it("rejects decode under wrong counter (replay protection)", async () => {
		const key = await keyFromHex(DEMO_KEY_HEX);
		const frame = await encodePersonReport(
			{
				mac: MAC_HEX,
				village: 1,
				ts: 1,
				lat: 23,
				lng: 121,
				alt: 0,
				addr: "X",
				count: 1,
				status: "unknown",
				flags: [],
			},
			key,
			42,
		);
		await expect(
			decodePersonReport(frame, key, 43, MAC_BYTES),
		).rejects.toThrow();
	});

	it("rejects tampered ciphertext before returning plaintext", async () => {
		const key = await keyFromHex(DEMO_KEY_HEX);
		const frame = await encodePersonReport(
			{
				mac: MAC_HEX,
				village: 1,
				ts: 1,
				lat: 23,
				lng: 121,
				alt: 0,
				addr: "X",
				count: 1,
				status: "unknown",
				flags: [],
			},
			key,
			44,
		);
		const tampered = new Uint8Array(frame);
		tampered[10] = (tampered[10] ?? 0) ^ 0xff;
		await expect(
			decodePersonReport(tampered, key, 44, MAC_BYTES),
		).rejects.toThrow();
	});
});

describe("packet codec / terrain_event", () => {
	it("round-trips and respects SPEC size", async () => {
		const key = await keyFromHex(DEMO_KEY_HEX);
		const frame = await encodeTerrainEvent(
			{
				mac: MAC_HEX,
				ts: 1759058500,
				lat: 12.34,
				lng: 56.78,
				event: "landslide",
				extent_m: 80,
				severity: 220,
				flags: [],
			},
			key,
			2,
		);
		expect(frame.length).toBe(TERRAIN_EVENT_SIZE);
		expect(frame[0]).toBe(0x02);
		const decoded = await decodeTerrainEvent(frame, key, 2, MAC_BYTES);
		expect(decoded.event).toBe("landslide");
		expect(decoded.extent_m).toBe(80);
		expect(decoded.severity).toBe(220);
	});

	it("round-trips drainage backflow terrain flags", async () => {
		const key = await keyFromHex(DEMO_KEY_HEX);
		const frame = await encodeTerrainEvent(
			{
				mac: MAC_HEX,
				ts: 1759058500,
				lat: 12.34,
				lng: 56.78,
				event: "drainage_backflow",
				extent_m: 350,
				severity: 210,
				flags: ["rapid_rainfall", "backflow_observed", "vehicles_trapped"],
			},
			key,
			5,
		);
		const decoded = await decodeTerrainEvent(frame, key, 5, MAC_BYTES);
		expect(decoded.event).toBe("drainage_backflow");
		expect(decoded.flags.sort()).toEqual([
			"backflow_observed",
			"rapid_rainfall",
			"vehicles_trapped",
		]);
	});
});

describe("packet codec / resource_report", () => {
	it("round-trips offer + request bitmaps", async () => {
		const key = await keyFromHex(DEMO_KEY_HEX);
		const frame = await encodeResourceReport(
			{
				mac: MAC_HEX,
				ts: 1759058600,
				lat: 12.34,
				lng: 56.78,
				addr: "WORKSITE",
				resource: ["food_water", "manpower"],
				quantity: 5,
				duration: 24,
				flags: ["urgent"],
			},
			key,
			3,
		);
		expect(frame.length).toBe(RESOURCE_REPORT_SIZE);
		expect(frame[0]).toBe(0x03);
		const decoded = await decodeResourceReport(frame, key, 3, MAC_BYTES);
		expect(decoded.addr).toBe("WORKSITE");
		expect(decoded.resource.sort()).toEqual(["food_water", "manpower"]);
		expect(decoded.quantity).toBe(5);
		expect(decoded.duration).toBe(24);
		expect(decoded.flags).toEqual(["urgent"]);
	});

	it("distinguishes request flag", async () => {
		const key = await keyFromHex(DEMO_KEY_HEX);
		const frame = await encodeResourceReport(
			{
				mac: MAC_HEX,
				ts: 1,
				lat: 0,
				lng: 0,
				addr: "X",
				resource: ["medical_aid"],
				quantity: 1,
				duration: 1,
				flags: ["is_request", "urgent"],
			},
			key,
			4,
		);
		const decoded = await decodeResourceReport(frame, key, 4, MAC_BYTES);
		expect(decoded.flags.sort()).toEqual(["is_request", "urgent"]);
	});

	it("round-trips warmth supplies as a resource kind", async () => {
		const key = await keyFromHex(DEMO_KEY_HEX);
		const frame = await encodeResourceReport(
			{
				mac: MAC_HEX,
				ts: 1,
				lat: 0,
				lng: 0,
				addr: "X",
				resource: ["warmth_supplies"],
				quantity: 11,
				duration: 0,
				flags: ["is_request", "urgent"],
			},
			key,
			6,
		);
		const decoded = await decodeResourceReport(frame, key, 6, MAC_BYTES);
		expect(decoded.resource).toEqual(["warmth_supplies"]);
		expect(decoded.quantity).toBe(11);
	});

	it("round-trips menstrual supplies as a resource kind", async () => {
		const key = await keyFromHex(DEMO_KEY_HEX);
		const frame = await encodeResourceReport(
			{
				mac: MAC_HEX,
				ts: 1,
				lat: 0,
				lng: 0,
				addr: "X",
				resource: ["menstrual_supplies"],
				quantity: 20,
				duration: 0,
				flags: ["is_request", "urgent"],
			},
			key,
			7,
		);
		const decoded = await decodeResourceReport(frame, key, 7, MAC_BYTES);
		expect(decoded.resource).toEqual(["menstrual_supplies"]);
		expect(decoded.quantity).toBe(20);
	});
});

describe("nonce construction", () => {
	it("builds 12-byte nonce from mac + counter little-endian + type byte", () => {
		const nonce = buildNonce(MAC_BYTES, 0x01020304, TYPE_PERSON_REPORT);
		expect(nonce.length).toBe(12);
		expect(Array.from(nonce.subarray(0, 6))).toEqual(Array.from(MAC_BYTES));
		expect(Array.from(nonce.subarray(6, 10))).toEqual([0x04, 0x03, 0x02, 0x01]);
		expect(Array.from(nonce.subarray(10, 12))).toEqual([TYPE_PERSON_REPORT, 0]);
	});

	it("separates packet types in nonce space for the same device counter", () => {
		const personNonce = buildNonce(MAC_BYTES, 7, TYPE_PERSON_REPORT);
		const terrainNonce = buildNonce(MAC_BYTES, 7, TYPE_TERRAIN_EVENT);
		const resourceNonce = buildNonce(MAC_BYTES, 7, TYPE_RESOURCE_REPORT);

		expect(Array.from(personNonce)).not.toEqual(Array.from(terrainNonce));
		expect(Array.from(terrainNonce)).not.toEqual(Array.from(resourceNonce));
	});

	it("rejects non-integer counters before nonce bytes are written", () => {
		expect(() => buildNonce(MAC_BYTES, 1.5, TYPE_PERSON_REPORT)).toThrow(
			RangeError,
		);
	});

	it("rejects negative counters before nonce bytes are written", () => {
		expect(() => buildNonce(MAC_BYTES, -1, TYPE_PERSON_REPORT)).toThrow(
			RangeError,
		);
	});

	it("rejects too large counters before nonce bytes are written", () => {
		expect(() =>
			buildNonce(MAC_BYTES, 0x1_0000_0000, TYPE_PERSON_REPORT),
		).toThrow(RangeError);
	});

	it("rejects invalid counters in the person encoder", async () => {
		await expectInvalidCounterEncode(encodePersonReport, {
			mac: MAC_HEX,
			village: 1,
			ts: 1,
			lat: 0,
			lng: 0,
			alt: 0,
			addr: "X",
			count: 1,
			status: "unknown",
			flags: [],
		});
	});

	it("rejects invalid counters in the terrain encoder", async () => {
		await expectInvalidCounterEncode(encodeTerrainEvent, {
			mac: MAC_HEX,
			ts: 1,
			lat: 0,
			lng: 0,
			event: "landslide",
			extent_m: 1,
			severity: 1,
			flags: [],
		});
	});

	it("rejects invalid counters in the resource encoder", async () => {
		await expectInvalidCounterEncode(encodeResourceReport, {
			mac: MAC_HEX,
			ts: 1,
			lat: 0,
			lng: 0,
			addr: "X",
			resource: ["food_water"],
			quantity: 1,
			duration: 1,
			flags: [],
		});
	});
});
