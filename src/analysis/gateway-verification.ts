import { hexToBytes } from "../bytes.ts";
import type { PacketJson } from "../packet/types.ts";
import { computeChainMac } from "./chain-mac.ts";
import { replayKeyOf } from "./replay.ts";

export interface GatewayVerificationState {
	readonly seenReplayKeys: ReadonlySet<string>;
	readonly lastChainMacByGateway: ReadonlyMap<string, string>;
}

export type GatewayVerificationError = "invalid_chain_mac" | "replay_detected";

export type GatewayVerificationResult =
	| { ok: true; state: GatewayVerificationState }
	| { ok: false; error: GatewayVerificationError };

const encoder = new TextEncoder();
const zeroAeadTag = new Uint8Array(4);

export const createGatewayVerificationState = (): GatewayVerificationState => ({
	seenReplayKeys: new Set(),
	lastChainMacByGateway: new Map(),
});

export const parseGatewayMacKeyHex = (value: string): Uint8Array => {
	if (!/^[0-9a-fA-F]{32}$/.test(value))
		throw new RangeError("gatewayMacKeyHex must be a 32-character hex string");
	return hexToBytes(value);
};

const typeByte = (type: PacketJson["type"]): number =>
	type === "person_report" ? 1 : type === "terrain_event" ? 2 : 3;

/**
 * Canonicalize packet payloads before signing decoded JSON. Object key order from
 * user JSON must not influence MAC verification, so every packet variant is
 * rebuilt in spec order before JSON.stringify feeds computeChainMac().
 */
const canonicalPacketPayload = (packet: PacketJson): string => {
	if (packet.type === "person_report")
		return JSON.stringify({
			mac: packet.packet.mac,
			village: packet.packet.village,
			ts: packet.packet.ts,
			lat: packet.packet.lat,
			lng: packet.packet.lng,
			alt: packet.packet.alt,
			addr: packet.packet.addr,
			count: packet.packet.count,
			status: packet.packet.status,
			flags: packet.packet.flags,
		});
	if (packet.type === "terrain_event")
		return JSON.stringify({
			mac: packet.packet.mac,
			ts: packet.packet.ts,
			lat: packet.packet.lat,
			lng: packet.packet.lng,
			event: packet.packet.event,
			extent_m: packet.packet.extent_m,
			severity: packet.packet.severity,
			flags: packet.packet.flags,
		});
	return JSON.stringify({
		mac: packet.packet.mac,
		ts: packet.packet.ts,
		lat: packet.packet.lat,
		lng: packet.packet.lng,
		addr: packet.packet.addr,
		resource: packet.packet.resource,
		quantity: packet.packet.quantity,
		duration: packet.packet.duration,
		flags: packet.packet.flags,
	});
};

/**
 * Sign decoded packet JSON with the same chain algorithm used for gateway audit.
 * Packet fields are canonicalized first, then encoded once so the HMAC input is
 * stable regardless of original object key order at the HTTP boundary.
 */
export const computePacketJsonChainMac = (
	gatewayKey: Uint8Array,
	previousChainMac: string,
	packet: PacketJson,
): Promise<string> => {
	const packetHeader = new Uint8Array([typeByte(packet.type)]);
	const ciphertext = encoder.encode(canonicalPacketPayload(packet));
	return computeChainMac({
		gatewayKey,
		previousChainMac,
		packetHeader,
		ciphertext,
		aeadTag: zeroAeadTag,
		receivedAt: packet.envelope.received_at,
		gatewayId: packet.envelope.gateway_id,
	});
};

const previousChainMacFor = (
	lastChainMacByGateway: ReadonlyMap<string, string>,
	gatewayId: string,
): string => {
	const chainMac = lastChainMacByGateway.get(gatewayId);
	return chainMac ?? "00";
};

const timingSafeEqualHex = (left: string, right: string): boolean => {
	// HMAC strings are public-size hex values, but byte-wise comparison avoids
	// making equality depend on the first differing nibble.
	if (left.length !== right.length) return false;
	const leftBytes = hexToBytes(left);
	const rightBytes = hexToBytes(right);
	return (
		leftBytes.reduce(
			(diff, byte, index) => diff | (byte ^ (rightBytes[index] ?? 0)),
			0,
		) === 0
	);
};

/**
 * Verify a whole batch transactionally. The returned state includes accepted
 * replay keys and gateway chain heads only when every packet verifies, preventing
 * forged or replayed batches from poisoning the process-local production window.
 */
export const verifyGatewayBatch = async (
	packets: readonly PacketJson[],
	gatewayKey: Uint8Array,
	state: GatewayVerificationState,
): Promise<GatewayVerificationResult> => {
	const seenReplayKeys = new Set(state.seenReplayKeys);
	const lastChainMacByGateway = new Map(state.lastChainMacByGateway);
	for (const packet of packets) {
		const replayKey = await replayKeyOf(packet);
		if (seenReplayKeys.has(replayKey))
			return { ok: false, error: "replay_detected" };
		const previousChainMac = previousChainMacFor(
			lastChainMacByGateway,
			packet.envelope.gateway_id,
		);
		const expected = await computePacketJsonChainMac(
			gatewayKey,
			previousChainMac,
			packet,
		);
		if (!timingSafeEqualHex(expected, packet.envelope.chain_mac.toLowerCase()))
			return { ok: false, error: "invalid_chain_mac" };
		seenReplayKeys.add(replayKey);
		lastChainMacByGateway.set(
			packet.envelope.gateway_id,
			packet.envelope.chain_mac.toLowerCase(),
		);
	}
	return { ok: true, state: { seenReplayKeys, lastChainMacByGateway } };
};
