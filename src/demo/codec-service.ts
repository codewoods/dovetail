import { match } from "ts-pattern";
import { runtimeConfig } from "../config/runtime.ts";
import {
	decodePersonReport,
	decodeResourceReport,
	decodeTerrainEvent,
	encodePersonReport,
	encodeResourceReport,
	encodeTerrainEvent,
	keyFromHex,
} from "../packet/codec.ts";
import type { PacketJson } from "../packet/types.ts";

const demoKey = keyFromHex(runtimeConfig.demoKeyHex);

const toHex = (bytes: Uint8Array): string =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const fromHex = (hex: string): Uint8Array => {
	const cleaned = hex.replace(/[^0-9a-fA-F]/g, "");
	if (cleaned.length % 2 !== 0) throw new RangeError("hex must be even length");
	const out = new Uint8Array(cleaned.length / 2);
	for (let i = 0; i < out.length; i++)
		out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
	return out;
};

/**
 * Server-side codec helpers for the browser demo. The demo key comes from the
 * private runtime config when present, otherwise a per-process key stays in memory
 * only. Encode assigns counters server-side so the public helper cannot be used
 * to force nonce reuse.
 */
export interface EncodeRequest {
	packet: PacketJson;
}

export interface EncodeResponse {
	hex: string;
	counter: number;
	size: number;
	plaintext_size: number;
}

const encodeCounters = new Map<string, number>();

/**
 * Demo encode is server-owned so HTTP callers cannot force nonce reuse. Counters
 * are scoped per device MAC and packet type, matching the nonce type byte.
 */
const nextCounterFor = (packet: PacketJson): number => {
	const key = `${packet.packet.mac.toLowerCase()}:${packet.type}`;
	const previous = encodeCounters.get(key) ?? 0;
	if (previous >= 0xffffffff) throw new RangeError("demo counter exhausted");
	const next = previous + 1;
	encodeCounters.set(key, next);
	return next;
};

export const encodeService = async (
	req: EncodeRequest,
): Promise<EncodeResponse> => {
	const counter = nextCounterFor(req.packet);
	const key = await demoKey;
	const bytes = await match(req.packet)
		.with({ type: "person_report" }, (p) =>
			encodePersonReport(p.packet, key, counter),
		)
		.with({ type: "terrain_event" }, (p) =>
			encodeTerrainEvent(p.packet, key, counter),
		)
		.with({ type: "resource_report" }, (p) =>
			encodeResourceReport(p.packet, key, counter),
		)
		.exhaustive();
	return {
		hex: toHex(bytes),
		counter,
		size: bytes.length,
		plaintext_size: bytes.length - 5,
	};
};

export interface DecodeRequest {
	hex: string;
	counter: number;
}

export interface DecodeResponse {
	packet: PacketJson;
	verified: boolean;
}

const macFromHex = (hexFrame: Uint8Array, offset: number): Uint8Array =>
	hexFrame.subarray(offset, offset + 6);

/**
 * Wire MAC sits inside the ciphertext, so we cannot pull it out without decrypting.
 * For the demo we pre-derive the nonce from the same MAC and public type byte the
 * encoder used; in a real gateway the receiver caches the MAC/counter binding.
 */
export const decodeService = async (
	req: DecodeRequest,
	knownMac: Uint8Array,
): Promise<DecodeResponse> => {
	const key = await demoKey;
	const frame = fromHex(req.hex);
	const type = frame[0];
	let packet: PacketJson;
	if (type === 0x01) {
		const decoded = await decodePersonReport(frame, key, req.counter, knownMac);
		packet = {
			type: "person_report",
			envelope: stubEnvelope(),
			packet: decoded,
		};
	} else if (type === 0x02) {
		const decoded = await decodeTerrainEvent(frame, key, req.counter, knownMac);
		packet = {
			type: "terrain_event",
			envelope: stubEnvelope(),
			packet: decoded,
		};
	} else if (type === 0x03) {
		const decoded = await decodeResourceReport(
			frame,
			key,
			req.counter,
			knownMac,
		);
		packet = {
			type: "resource_report",
			envelope: stubEnvelope(),
			packet: decoded,
		};
	} else {
		throw new RangeError(`unknown type byte 0x${type?.toString(16)}`);
	}
	return { packet, verified: true };
};

const DEMO_CHAIN_MAC = "0".repeat(64);

// Decode rebuilds a PacketJson envelope after AEAD verification; the demo
// placeholder chain MAC stays schema-valid without pretending to be a real
// gateway HMAC chain value.
const stubEnvelope = () => ({
	received_at: new Date().toISOString(),
	gateway_id: "TW-HUA-GFG-001",
	aead_profile: "aead-gcm-128" as const,
	chain_mac: DEMO_CHAIN_MAC,
});

export { fromHex, macFromHex, toHex };
