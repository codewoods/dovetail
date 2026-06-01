import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computePacketJsonChainMac } from "../src/analysis/gateway-verification.ts";
import worker, { __resetForTests } from "../src/index.ts";
import type { PacketJson } from "../src/packet/types.ts";

const GATEWAY_KEY_HEX = "42424242424242424242424242424242";
const RECEIVED_SEC = 1_759_058_400;
const RECEIVED_ISO = new Date(RECEIVED_SEC * 1000).toISOString();
let tempDirs: string[] = [];

/**
 * Tests sign the same canonical decoded-JSON payload that production gateway
 * verification accepts at the HTTP boundary. This mirrors the demo fixture mode:
 * original LoRa ciphertext is not present once packets have become JSON, so a
 * zero AEAD tag keeps the chain algorithm inspectable without claiming to redo
 * device-level AEAD verification.
 */
const signPacket = async (
	packet: PacketJson,
	previousChainMac = "00",
): Promise<PacketJson> => {
	const gatewayKey = Uint8Array.from(
		GATEWAY_KEY_HEX.match(/.{2}/g) ?? [],
		(byte) => parseInt(byte, 16),
	);
	const chain_mac = await computePacketJsonChainMac(
		gatewayKey,
		previousChainMac,
		packet,
	);
	return { ...packet, envelope: { ...packet.envelope, chain_mac } };
};

const withChainMac = (packet: PacketJson, chain_mac: string): PacketJson => ({
	...packet,
	envelope: { ...packet.envelope, chain_mac },
});

const examplePacket = (mac: string, ts = RECEIVED_SEC): PacketJson => ({
	type: "person_report",
	envelope: {
		received_at: RECEIVED_ISO,
		gateway_id: "TW-HUA-GATEWAY-TEST",
		aead_profile: "aead-gcm-128",
		chain_mac: "0".repeat(64),
	},
	packet: {
		mac,
		village: 1_003_012,
		ts,
		lat: 0.125,
		lng: 0.25,
		alt: 130,
		addr: "MOCK01",
		count: 6,
		status: "evacuated_shelter",
		flags: [],
	},
});

/**
 * Serialize packet batches through the same HTTP request shape used in production
 * mode so each test covers validation, verification, and analysis wiring together.
 */
const packetRequest = (
	url: string,
	packets: readonly PacketJson[],
): Request => {
	const payload = JSON.stringify(packets);
	return new Request(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: payload,
	});
};

const postPackets = (packets: readonly PacketJson[]): Promise<Response> => {
	const request = packetRequest("https://example.org/api/packets", packets);
	return worker.fetch(request);
};

const postExportPackets = (
	packets: readonly PacketJson[],
): Promise<Response> => {
	const request = packetRequest(
		"https://example.org/api/packets/export?profile=township&format=json",
		packets,
	);
	return worker.fetch(request);
};

const verificationModeHeader = (response: Response): string =>
	response.headers.get("x-dovetail-verification-mode") ?? "";

const tempStatePath = async (): Promise<string> => {
	const dir = await mkdtemp(join(tmpdir(), "dovetail-gateway-state-"));
	tempDirs.push(dir);
	return join(dir, "state.json");
};

// Reset module/env state and remove temp persistence files so each verification
// test starts with an explicit trust boundary and no hidden replay artifacts.
afterEach(async () => {
	__resetForTests();
	delete process.env.DOVETAIL_GATEWAY_MAC_KEY_HEX;
	delete process.env.DOVETAIL_ALLOW_UNVERIFIED_INGEST;
	delete process.env.DOVETAIL_DEPLOYMENT_MODE;
	delete process.env.DOVETAIL_GATEWAY_VERIFICATION_STATE_PATH;
	await Promise.all(
		tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
	);
	tempDirs = [];
});

describe("production gateway verification mode", () => {
	it("accepts signed decoded packet JSON when the gateway key is present", async () => {
		process.env.DOVETAIL_GATEWAY_MAC_KEY_HEX = GATEWAY_KEY_HEX;
		const signed = await signPacket(examplePacket("5C8AF3001001"));

		const response = await postPackets([signed]);
		const body = (await response.json()) as {
			rejected: unknown[];
			verification_mode: string;
			semantic_verification: string;
		};

		expect(response.status).toBe(200);
		expect(body.rejected).toEqual([]);
		expect(body.verification_mode).toBe("verified");
		expect(body.semantic_verification).toBe(
			"field_observation_unverified_truth",
		);
		expect(verificationModeHeader(response)).toBe("verified");
	});

	it("rejects chain_mac mismatch before analysis", async () => {
		process.env.DOVETAIL_GATEWAY_MAC_KEY_HEX = GATEWAY_KEY_HEX;
		const forged = withChainMac(
			await signPacket(examplePacket("5C8AF3001002")),
			"f".repeat(64),
		);

		const response = await postPackets([forged]);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "invalid_chain_mac" });
	});

	it("keeps gateway chain state transactional after a failed batch", async () => {
		// A failed verification must not advance lastChainMacByGateway or reserve
		// replay keys; the next packet signed from the last accepted chain head
		// must still pass so performance changes cannot corrupt audit continuity.
		process.env.DOVETAIL_GATEWAY_MAC_KEY_HEX = GATEWAY_KEY_HEX;
		const first = await signPacket(examplePacket("5C8AF3001012"));
		const forged = withChainMac(examplePacket("5C8AF3001013"), "d".repeat(64));
		const validFollowUp = await signPacket(
			examplePacket("5C8AF3001014"),
			first.envelope.chain_mac,
		);

		const accepted = await postPackets([first]);
		const failed = await postPackets([forged]);
		const recovered = await postPackets([validFollowUp]);
		const recoveredBody = (await recovered.json()) as {
			rejected: unknown[];
			verification_mode: string;
		};

		expect(accepted.status).toBe(200);
		expect(failed.status).toBe(400);
		expect(await failed.json()).toEqual({ error: "invalid_chain_mac" });
		expect(recovered.status).toBe(200);
		expect(recoveredBody.rejected).toEqual([]);
		expect(recoveredBody.verification_mode).toBe("verified");
		expect(verificationModeHeader(recovered)).toBe("verified");
	});

	it("does not commit partial successes from a failed multi-packet batch", async () => {
		// Gateway state advances only after the whole batch verifies. A valid
		// first packet followed by a forged second packet must not reserve the
		// first replay key or chain head before the batch returns 400.
		process.env.DOVETAIL_GATEWAY_MAC_KEY_HEX = GATEWAY_KEY_HEX;
		const first = await signPacket(examplePacket("5C8AF3001015"));
		const forgedSecond = withChainMac(
			examplePacket("5C8AF3001016"),
			"c".repeat(64),
		);

		const failed = await postPackets([first, forgedSecond]);
		const recovered = await postPackets([first]);
		const recoveredBody = (await recovered.json()) as {
			rejected: unknown[];
			verification_mode: string;
		};

		expect(failed.status).toBe(400);
		expect(await failed.json()).toEqual({ error: "invalid_chain_mac" });
		expect(recovered.status).toBe(200);
		expect(recoveredBody.rejected).toEqual([]);
		expect(recoveredBody.verification_mode).toBe("verified");
	});

	it("rejects replayed packets across later batches", async () => {
		process.env.DOVETAIL_GATEWAY_MAC_KEY_HEX = GATEWAY_KEY_HEX;
		const signed = await signPacket(examplePacket("5C8AF3001003"));

		const first = await postPackets([signed]);
		const replay = await postPackets([signed]);

		expect(first.status).toBe(200);
		expect(replay.status).toBe(409);
		expect(await replay.json()).toEqual({ error: "replay_detected" });
	});

	it("serializes concurrent verification so one replayed packet fails", async () => {
		process.env.DOVETAIL_GATEWAY_MAC_KEY_HEX = GATEWAY_KEY_HEX;
		const signed = await signPacket(examplePacket("5C8AF3001021"));

		const responses = await Promise.all([
			postPackets([signed]),
			postPackets([signed]),
		]);
		const statuses = responses.map((response) => response.status).sort();

		expect(statuses).toEqual([200, 409]);
	});

	it("persists verified replay state across process-local resets when configured", async () => {
		process.env.DOVETAIL_GATEWAY_MAC_KEY_HEX = GATEWAY_KEY_HEX;
		process.env.DOVETAIL_GATEWAY_VERIFICATION_STATE_PATH =
			await tempStatePath();
		const signed = await signPacket(examplePacket("5C8AF3001020"));

		const first = await postPackets([signed]);
		__resetForTests();
		const replay = await postPackets([signed]);

		expect(first.status).toBe(200);
		expect(replay.status).toBe(409);
		expect(await replay.json()).toEqual({ error: "replay_detected" });
	});

	it("keeps replay precedence ahead of invalid chain_mac on later batches", async () => {
		// Once a replay key has been accepted, the next batch must fail as replay
		// before HMAC mismatch so failure semantics cannot drift during MAC work.
		process.env.DOVETAIL_GATEWAY_MAC_KEY_HEX = GATEWAY_KEY_HEX;
		const signed = await signPacket(examplePacket("5C8AF3001017"));
		const forgedReplay = withChainMac(signed, "b".repeat(64));

		const first = await postPackets([signed]);
		const replay = await postPackets([forgedReplay]);

		expect(first.status).toBe(200);
		expect(replay.status).toBe(409);
		expect(await replay.json()).toEqual({ error: "replay_detected" });
	});

	it("ignores timestamp-rejected packets before gateway verification so later packets are not poisoned", async () => {
		process.env.DOVETAIL_GATEWAY_MAC_KEY_HEX = GATEWAY_KEY_HEX;
		const first = await signPacket(examplePacket("5C8AF3001009"));
		const firstResponse = await postPackets([first]);
		const stale = await signPacket(
			examplePacket("5C8AF3001010", RECEIVED_SEC - 10_000),
			first.envelope.chain_mac,
		);
		const followUp = await signPacket(
			examplePacket("5C8AF3001011"),
			first.envelope.chain_mac,
		);
		const response = await postPackets([stale, followUp]);
		const body = (await response.json()) as {
			rejected: Array<{ reason: string }>;
			verification_mode: string;
		};

		expect(firstResponse.status).toBe(200);
		expect(response.status).toBe(200);
		expect(body.rejected.map((packet) => packet.reason)).toEqual([
			"timestamp_out_of_window",
		]);
		expect(body.verification_mode).toBe("verified");
	});

	it("applies chain_mac verification to agency exports too", async () => {
		process.env.DOVETAIL_GATEWAY_MAC_KEY_HEX = GATEWAY_KEY_HEX;
		const forged = withChainMac(
			await signPacket(examplePacket("5C8AF3001004")),
			"e".repeat(64),
		);

		const response = await postExportPackets([forged]);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "invalid_chain_mac" });
	});

	it("fails closed by default when neither a key nor demo opt-in is set", async () => {
		// Spec §8.0.1: missing key without DOVETAIL_ALLOW_UNVERIFIED_INGEST=1
		// must return 503 instead of silently accepting unverified packets.
		// The shared test setup opts every test into demo mode, so this case
		// explicitly removes the flag to exercise the fail-closed default.
		delete process.env.DOVETAIL_ALLOW_UNVERIFIED_INGEST;
		const response = await postPackets([examplePacket("5C8AF3001005")]);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: "gateway_verification_not_configured",
		});
	});

	it("accepts opt-in demo ingest and stamps demo_unverified mode", async () => {
		// Explicit demo opt-in path keeps the keyless evaluator workflow working
		// while making the verification bypass observable to downstream audit.
		process.env.DOVETAIL_ALLOW_UNVERIFIED_INGEST = "1";
		const response = await postPackets([examplePacket("5C8AF3001006")]);
		const body = (await response.json()) as {
			verification_mode: string;
			semantic_verification: string;
		};

		expect(response.status).toBe(200);
		expect(body.verification_mode).toBe("demo_unverified");
		expect(body.semantic_verification).toBe(
			"field_observation_unverified_truth",
		);
		expect(verificationModeHeader(response)).toBe("demo_unverified");
	});

	it("rejects unverified demo ingest when deployment mode is production", async () => {
		process.env.DOVETAIL_DEPLOYMENT_MODE = "production";
		process.env.DOVETAIL_ALLOW_UNVERIFIED_INGEST = "1";
		const response = await postPackets([examplePacket("5C8AF3001019")]);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: "demo_unverified_not_allowed_in_production",
		});
	});

	it("emits the verification mode header on default CSV exports without altering the body", async () => {
		// Default CSV export keeps the fixed header (spec §10) so existing
		// spreadsheet importers still parse cleanly; the audit signal travels
		// via the response header only. arrayBuffer() is used because
		// Response.text() strips the UTF-8 BOM during decode.
		process.env.DOVETAIL_ALLOW_UNVERIFIED_INGEST = "1";
		const url =
			"https://example.org/api/packets/export?profile=township&format=csv";
		const request = packetRequest(url, [examplePacket("5C8AF3001007")]);
		const response = await worker.fetch(request);
		const bytes = new Uint8Array(await response.arrayBuffer());

		expect(response.status).toBe(200);
		expect(verificationModeHeader(response)).toBe("demo_unverified");
		expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
		const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
		expect(body.split("\n")[0]).toBe(
			"﻿profile,section,area,cluster_id,kind,status,count,max_severity,latest_ts",
		);
		expect(body).not.toContain("# verification_mode=");
	});

	it("prepends an opt-in metadata row to CSV exports when include_metadata=1", async () => {
		// Cross-agency file transfers carry the audit signal in-band when the
		// caller opts in; comment prefix '#' is the documented skip token.
		process.env.DOVETAIL_ALLOW_UNVERIFIED_INGEST = "1";
		const url =
			"https://example.org/api/packets/export?profile=township&format=csv&include_metadata=1";
		const request = packetRequest(url, [examplePacket("5C8AF3001008")]);
		const response = await worker.fetch(request);
		const bytes = new Uint8Array(await response.arrayBuffer());

		expect(response.status).toBe(200);
		expect(verificationModeHeader(response)).toBe("demo_unverified");
		expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
		const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
		const lines = body.slice(1).split("\n");
		expect(lines[0]).toMatch(
			/^# verification_mode=demo_unverified,semantic_verification=field_observation_unverified_truth,exported_at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
		);
		expect(lines[1]).toBe(
			"profile,section,area,cluster_id,kind,status,count,max_severity,latest_ts",
		);
	});

	it("prepends verified CSV metadata consistently with the response header", async () => {
		// Verified exports carry the same audit mode in the HTTP header and the
		// opt-in metadata row, keeping JSON and CSV verification semantics aligned.
		process.env.DOVETAIL_GATEWAY_MAC_KEY_HEX = GATEWAY_KEY_HEX;
		const signed = await signPacket(examplePacket("5C8AF3001018"));
		const url =
			"https://example.org/api/packets/export?profile=township&format=csv&include_metadata=1";
		const response = await worker.fetch(packetRequest(url, [signed]));
		const bytes = new Uint8Array(await response.arrayBuffer());

		expect(response.status).toBe(200);
		expect(verificationModeHeader(response)).toBe("verified");
		expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
		const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
		expect(body.slice(1).split("\n")[0]).toMatch(
			/^# verification_mode=verified,semantic_verification=field_observation_unverified_truth,exported_at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
		);
	});
});
