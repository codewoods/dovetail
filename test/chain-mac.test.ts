import { describe, expect, it } from "vitest";
import { computeChainMac } from "../src/analysis/chain-mac.ts";

const hexToBytes = (hex: string): Uint8Array =>
	Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) => parseInt(byte, 16));

interface LegacyPayloadInput {
	previousChainMac: string;
	packetHeader: Uint8Array;
	ciphertext: Uint8Array;
	aeadTag: Uint8Array;
	receivedAt: string;
	gatewayId: string;
}

const byteString = (bytes: Uint8Array): string =>
	Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

const legacyPayloadString = (input: LegacyPayloadInput): string =>
	`${byteString(hexToBytes(input.previousChainMac))}${byteString(input.packetHeader)}${byteString(input.ciphertext)}${byteString(input.aeadTag)}${input.receivedAt}${input.gatewayId}`;

describe("gateway chain MAC helper", () => {
	it("is deterministic and chains previous MAC into the next link", async () => {
		const input = {
			gatewayKey: new Uint8Array(16).fill(7),
			previousChainMac: "00",
			packetHeader: Uint8Array.from([0x01]),
			ciphertext: Uint8Array.from([0xaa, 0xbb, 0xcc]),
			aeadTag: Uint8Array.from([0x10, 0x20, 0x30, 0x40]),
			receivedAt: "2026-09-23T14:32:11Z",
			gatewayId: "TW-HUA-GFG-001",
		};

		const first = await computeChainMac(input);
		const second = await computeChainMac(input);
		const chained = await computeChainMac({
			...input,
			previousChainMac: first,
		});

		expect(first).toMatch(/^[0-9a-f]{64}$/);
		expect(second).toBe(first);
		expect(chained).not.toBe(first);
	});

	it("frames variable-length fields so raw-adjacent splits do not collide", async () => {
		const sharedTail = {
			aeadTag: Uint8Array.of(),
			receivedAt: "x",
			gatewayId: "yz",
		};
		const left = {
			previousChainMac: "0a0b",
			packetHeader: Uint8Array.of(0x0c),
			ciphertext: Uint8Array.of(),
			...sharedTail,
		};
		const right = {
			previousChainMac: "0a",
			packetHeader: Uint8Array.of(0x0b, 0x0c),
			ciphertext: Uint8Array.of(),
			...sharedTail,
		};
		const key = new Uint8Array(16).fill(7);
		const leftMac = await computeChainMac({ gatewayKey: key, ...left });
		const rightMac = await computeChainMac({ gatewayKey: key, ...right });

		expect(legacyPayloadString(left)).toBe(legacyPayloadString(right));
		expect(leftMac).not.toBe(rightMac);
	});
});
