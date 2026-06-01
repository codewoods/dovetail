import { describe, expect, it } from "vitest";
import { analyseAtIngress } from "../src/analysis/api.ts";
import {
	filterReplays,
	replayKeyOf,
	WINDOW_SECONDS,
} from "../src/analysis/replay.ts";
import type { PacketJson } from "../src/packet/types.ts";

const RECEIVED_SEC = 1747785600;
const RECEIVED_ISO = new Date(RECEIVED_SEC * 1000).toISOString();

const envelopeFor = (receivedSec = RECEIVED_SEC) => ({
	received_at: new Date(receivedSec * 1000).toISOString(),
	gateway_id: "TW-HUA-MAS-001",
	aead_profile: "aead-gcm-128" as const,
	chain_mac: "a".repeat(64),
});

const terrainPacket = (
	overrides: Partial<{ mac: string; ts: number; receivedSec: number }> = {},
): PacketJson => ({
	type: "terrain_event",
	envelope: envelopeFor(overrides.receivedSec ?? RECEIVED_SEC),
	packet: {
		mac: overrides.mac ?? "5C8AF3000001",
		ts: overrides.ts ?? RECEIVED_SEC,
		lat: 0.125,
		lng: 0.25,
		event: "landslide",
		extent_m: 50,
		severity: 2,
		flags: [],
	},
});

describe("replayKeyOf", () => {
	it("hashes type byte, mac, and timestamp instead of echoing device identifiers", async () => {
		const key = await replayKeyOf(
			terrainPacket({ mac: "AABBCCDDEEFF", ts: 0x12345678 }),
		);
		expect(key).toBe(
			"2f132e7f3ebf85a3ce46b2a20e511170728d54ba46989402ab6b104d25ffe870",
		);
		expect(key).toMatch(/^[0-9a-f]{64}$/);
		expect(key).not.toContain("aabbccddeeff");
		expect(key).not.toContain("12345678");
	});

	it("separates packet types for the same device timestamp", async () => {
		const terrain = terrainPacket({ mac: "AABBCCDDEEFF", ts: 0x12345678 });
		const person: PacketJson = {
			type: "person_report",
			envelope: terrain.envelope,
			packet: {
				mac: "AABBCCDDEEFF",
				village: 1,
				ts: 0x12345678,
				lat: 0.125,
				lng: 0.25,
				alt: 10,
				addr: "MOCK",
				count: 1,
				status: "unknown",
				flags: [],
			},
		};

		await expect(replayKeyOf(person)).resolves.not.toBe(
			await replayKeyOf(terrain),
		);
	});
});

describe("filterReplays", () => {
	it("rejects duplicate replay keys and preserves order", async () => {
		const packets = [
			terrainPacket(),
			terrainPacket(),
			terrainPacket({ mac: "5C8AF3000002" }),
		];
		const { accepted, rejected } = await filterReplays(packets);
		expect(accepted.length).toBe(2);
		expect(rejected).toEqual([
			{
				index: 1,
				replay_key: await replayKeyOf(packets[1]!),
				reason: "duplicate_replay_key",
			},
		]);
	});

	it("rejects ts outside ±WINDOW_SECONDS of envelope.received_at", async () => {
		const tooOld = terrainPacket({ ts: RECEIVED_SEC - (WINDOW_SECONDS + 1) });
		const tooNew = terrainPacket({
			mac: "5C8AF3000002",
			ts: RECEIVED_SEC + (WINDOW_SECONDS + 1),
		});
		const onEdge = terrainPacket({
			mac: "5C8AF3000003",
			ts: RECEIVED_SEC - WINDOW_SECONDS,
		});
		const { accepted, rejected } = await filterReplays([
			tooOld,
			tooNew,
			onEdge,
		]);
		expect(accepted).toEqual([onEdge]);
		expect(rejected.map((r) => r.reason)).toEqual([
			"timestamp_out_of_window",
			"timestamp_out_of_window",
		]);
	});

	it("rejects packets whose received_at cannot be parsed", async () => {
		const packet = terrainPacket();
		// Upstream schema validation normally catches this, but filterReplays is a
		// standalone safety boundary and should fail closed for direct helper calls.
		const malformed = {
			...packet,
			envelope: { ...packet.envelope, received_at: "not-a-date" },
		};
		const { accepted, rejected } = await filterReplays([malformed]);
		expect(accepted).toEqual([]);
		expect(rejected).toEqual([
			{
				index: 0,
				replay_key: await replayKeyOf(malformed),
				reason: "timestamp_out_of_window",
			},
		]);
	});

	it("dedup beats window when both apply", async () => {
		const packets = [terrainPacket(), terrainPacket()];
		const { rejected } = await filterReplays(packets);
		expect(rejected[0]!.reason).toBe("duplicate_replay_key");
	});
});

describe("analyseAtIngress", () => {
	it("excludes rejected packets from aggregation and surfaces them in result", async () => {
		const fresh = terrainPacket();
		const replay = terrainPacket();
		const result = await analyseAtIngress([fresh, replay], RECEIVED_ISO);
		expect(result.rejected.length).toBe(1);
		expect(result.overlays.length).toBe(1);
		expect(result.event_queue.totalPackets).toBe(1);
	});

	it("returns empty rejected list when batch is clean", async () => {
		const result = await analyseAtIngress([terrainPacket()], RECEIVED_ISO);
		expect(result.rejected).toEqual([]);
	});

	it("keeps timestamp-rejected packets out of the accepted analysis subset", async () => {
		const stale = terrainPacket({ ts: RECEIVED_SEC - (WINDOW_SECONDS + 10) });
		const fresh = terrainPacket({ mac: "5C8AF3000004" });
		const result = await analyseAtIngress([stale, fresh], RECEIVED_ISO);

		expect(result.rejected).toEqual([
			{
				index: 0,
				replay_key: await replayKeyOf(stale),
				reason: "timestamp_out_of_window",
			},
		]);
		expect(result.summary.packet_count).toBe(1);
		expect(result.event_queue.totalPackets).toBe(1);
	});
});
