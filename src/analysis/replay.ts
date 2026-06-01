import { bytesToHex, hexToBytes } from "../bytes.ts";
import type { PacketJson } from "../packet/types.ts";

/**
 * Replay rejection per SPEC.md §8.1.1.
 *
 * The dedupe key (`replay_key`) is a SHA-256 digest of packet type, MAC and
 * timestamp. It is distinct from the AEAD nonce (spec §3 `device_mac ||
 * packet_counter || packet_type || reserved`, 12 bytes). The replay_key lives at
 * the JSON layer where the cryptographic counter is no longer available; the
 * AEAD nonce already guaranteed integrity at decode time, so this layer only
 * needs an order-preserving uniqueness check without echoing device identifiers.
 *
 * The window comparison uses `envelope.received_at` (gateway-asserted) against
 * `packet.ts`, making the property intrinsic to the batch — reproducible
 * regardless of when vitest or the offline demo runs the analysis. Cross-batch
 * persistence and chain_mac value verification stay a production gateway
 * responsibility (§8); this helper guarantees only deterministic per-batch
 * dedupe.
 */
export const WINDOW_SECONDS = 300;

export type ReplayReason = "duplicate_replay_key" | "timestamp_out_of_window";

export interface RejectedPacket {
	index: number;
	replay_key: string;
	reason: ReplayReason;
}

export interface ReplayFilterResult {
	accepted: PacketJson[];
	rejected: RejectedPacket[];
}

/**
 * Build a privacy-preserving replay key from type byte, packet `mac` and `ts`.
 * The raw MAC stays out of rejected[] while the type byte prevents cross-type
 * collisions for devices that use per-type counters.
 */
export const replayKeyOf = async (packet: PacketJson): Promise<string> => {
	const timestamp = new Uint8Array(4);
	new DataView(timestamp.buffer).setUint32(0, packet.packet.ts >>> 0, true);
	const material = new Uint8Array(11);
	material[0] = typeByte(packet.type);
	material.set(hexToBytes(packet.packet.mac), 1);
	material.set(timestamp, 7);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		material as Uint8Array<ArrayBuffer>,
	);
	return bytesToHex(new Uint8Array(digest));
};

const typeByte = (type: PacketJson["type"]): number =>
	type === "person_report" ? 1 : type === "terrain_event" ? 2 : 3;

const receivedAtSec = (packet: PacketJson): number | null => {
	const receivedAtMs = Date.parse(packet.envelope.received_at);
	return Number.isFinite(receivedAtMs) ? Math.floor(receivedAtMs / 1000) : null;
};

/**
 * Single-pass filter. Iterates packets in input order, classifies each as
 * accepted or rejected, and preserves input indexes in `rejected` so callers
 * can correlate with their batch. The seen-set is local so the result is
 * purely a function of `packets` — no shared mutable state across calls.
 */
export const filterReplays = async (
	packets: PacketJson[],
): Promise<ReplayFilterResult> => {
	const seen = new Set<string>();
	const accepted: PacketJson[] = [];
	const rejected: RejectedPacket[] = [];
	for (const [index, packet] of packets.entries()) {
		const replay_key = await replayKeyOf(packet);
		if (seen.has(replay_key)) {
			rejected.push({ index, replay_key, reason: "duplicate_replay_key" });
			continue;
		}
		const receivedSec = receivedAtSec(packet);
		if (
			receivedSec === null ||
			Math.abs(receivedSec - packet.packet.ts) > WINDOW_SECONDS
		) {
			rejected.push({ index, replay_key, reason: "timestamp_out_of_window" });
			continue;
		}
		seen.add(replay_key);
		accepted.push(packet);
	}
	return { accepted, rejected };
};
