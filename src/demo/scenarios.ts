import { computeChainMac } from "../analysis/chain-mac.ts";
import type {
	PacketEnvelope,
	PacketJson,
	PersonFlag,
	PersonStatus,
	ResourceFlag,
	ResourceKind,
	TerrainEvent,
	TerrainFlag,
} from "../packet/types.ts";
import rawScenarios from "./scenarios-data.json";

/**
 * 預設情境讓評審從下拉選單驅動 packet sequences.
 * Synthetic reports on public reference coordinates show GIS behavior
 * without encoding traceable residents, households, or field informants.
 */
export interface DemoScenario {
	id: string;
	label: string;
	description: string;
	source: string;
	location_policy: string;
	occurred_at_utc: string;
	display_timezone: string;
	packets: PacketJson[];
}

interface RawScenario {
	id: string;
	label: string;
	description: string;
	source: string;
	location_policy: string;
	occurred_at_utc: string;
	display_timezone: string;
	packets: RawPacket[];
}

type RawPacket = RawPersonPacket | RawTerrainPacket | RawResourcePacket;

interface RawPersonPacket {
	packet_type: "person_report";
	mac: string;
	village: number;
	lat: number;
	lng: number;
	addr: string;
	count: number;
	status: PersonStatus;
	flags: PersonFlag[];
}

interface RawTerrainPacket {
	packet_type: "terrain_event";
	mac: string;
	lat: number;
	lng: number;
	event: TerrainEvent;
	extent_m: number;
	severity: number;
	flags?: TerrainFlag[];
}

interface RawResourcePacket {
	packet_type: "resource_report";
	mac: string;
	lat: number;
	lng: number;
	addr: string;
	resource: ResourceKind[];
	quantity: number;
	duration: number;
	flags: ResourceFlag[];
}

const epochSeconds = (iso: string): number =>
	Math.floor(Date.parse(iso) / 1000);

const isoFromEpochSeconds = (seconds: number): string =>
	new Date(seconds * 1000).toISOString();

const demoTs = (baseSeconds: number, ...parts: string[]): number =>
	baseSeconds +
	Array.from(parts.join("|")).reduce(
		(sum, char) => (sum + char.charCodeAt(0)) % 240,
		0,
	);

/** Offset received_at by 300s so hash-derived packet ts stays inside replay window. */
const scenarioEnvelope = (scenario: RawScenario): PacketEnvelope => ({
	received_at: isoFromEpochSeconds(
		epochSeconds(scenario.occurred_at_utc) + 300,
	),
	gateway_id: "TW-HUA-GFG-001",
	aead_profile: "aead-gcm-128",
	chain_mac: "00",
});

/**
 * Convert each raw synthetic packet into the public PacketJson union while deriving
 * reproducible UTC timestamps from scenario metadata instead of wall-clock time.
 */
const toPacketJson = (
	packet: RawPacket,
	baseSeconds: number,
	envelope: PacketEnvelope,
): PacketJson => {
	if (packet.packet_type === "person_report")
		return {
			type: "person_report",
			envelope,
			packet: {
				mac: packet.mac,
				village: packet.village,
				ts: demoTs(
					baseSeconds,
					packet.mac,
					packet.addr,
					packet.status,
					String(packet.count),
				),
				lat: packet.lat,
				lng: packet.lng,
				alt: 130,
				addr: packet.addr,
				count: packet.count,
				status: packet.status,
				flags: packet.flags,
			},
		};
	if (packet.packet_type === "terrain_event")
		return {
			type: "terrain_event",
			envelope,
			packet: {
				mac: packet.mac,
				ts: demoTs(
					baseSeconds,
					packet.mac,
					packet.event,
					String(packet.extent_m),
					String(packet.severity),
				),
				lat: packet.lat,
				lng: packet.lng,
				event: packet.event,
				extent_m: packet.extent_m,
				severity: packet.severity,
				flags: packet.flags ?? [],
			},
		};
	return {
		type: "resource_report",
		envelope,
		packet: {
			mac: packet.mac,
			ts: demoTs(
				baseSeconds,
				packet.mac,
				packet.addr,
				packet.resource.join(","),
				String(packet.quantity),
				String(packet.duration),
			),
			lat: packet.lat,
			lng: packet.lng,
			addr: packet.addr,
			resource: packet.resource,
			quantity: packet.quantity,
			duration: packet.duration,
			flags: packet.flags,
		},
	};
};

const typeByte = (type: PacketJson["type"]): number =>
	type === "person_report" ? 1 : type === "terrain_event" ? 2 : 3;

/**
 * Rebuild PacketJson with a fresh envelope while preserving discriminated union
 * narrowing so downstream code that branches on `type` stays type-safe.
 */
const withEnvelope = (
	item: PacketJson,
	nextEnvelope: PacketEnvelope,
): PacketJson => {
	if (item.type === "person_report")
		return {
			type: "person_report",
			envelope: nextEnvelope,
			packet: item.packet,
		};
	if (item.type === "terrain_event")
		return {
			type: "terrain_event",
			envelope: nextEnvelope,
			packet: item.packet,
		};
	return {
		type: "resource_report",
		envelope: nextEnvelope,
		packet: item.packet,
	};
};

/**
 * Walk each scenario's packets sequentially and replace the placeholder chain_mac
 * with an HMAC-SHA-256 produced by computeChainMac(). The demo signs over the
 * canonical packet JSON instead of real AEAD ciphertext+tag, because the
 * scenarios are pre-encryption fixtures; this still exercises the same chain
 * algorithm an evaluator can inspect inside src/analysis/chain-mac.ts.
 *
 * The demo also substitutes a zero `aeadTag: Uint8Array(4)`, so the chain MAC
 * value produced here will differ from the spec §8 value computed against real
 * ciphertext+tag — only the algorithm and field order are identical.
 *
 * The signing key is generated per process at module load. A constant key would
 * ship a reusable HMAC seed via `/api/scenarios` and risk integrators copying
 * demo chain values into production audit batches; randomising it scopes the
 * chain value to the running process.
 */
const DEMO_GATEWAY_KEY = crypto.getRandomValues(new Uint8Array(16));

const enrichChainMacs = async (
	scenarios: DemoScenario[],
): Promise<DemoScenario[]> =>
	Promise.all(
		scenarios.map(async (scenario) => {
			let previousChainMac = "00";
			const packets: PacketJson[] = [];
			for (const item of scenario.packets) {
				const payload = new TextEncoder().encode(JSON.stringify(item.packet));
				const mac = await computeChainMac({
					gatewayKey: DEMO_GATEWAY_KEY,
					previousChainMac,
					packetHeader: new Uint8Array([typeByte(item.type)]),
					ciphertext: payload,
					aeadTag: new Uint8Array(4),
					receivedAt: item.envelope.received_at,
					gatewayId: item.envelope.gateway_id,
				});
				packets.push(withEnvelope(item, { ...item.envelope, chain_mac: mac }));
				previousChainMac = mac;
			}
			return { ...scenario, packets };
		}),
	);

/**
 * Build scenario packet JSON from synthetic metadata while keeping record timestamps
 * in UTC. The display layer formats `occurred_at_utc` separately for operators.
 */
const buildScenario = (scenario: RawScenario): DemoScenario => {
	const baseSeconds = epochSeconds(scenario.occurred_at_utc);
	const envelope = scenarioEnvelope(scenario);
	return {
		...scenario,
		packets: scenario.packets.map((packet) =>
			toPacketJson(packet, baseSeconds, envelope),
		),
	};
};

const buildScenarios = (scenarios: RawScenario[]): DemoScenario[] =>
	scenarios.map(buildScenario);

export const DEMO_SCENARIOS: DemoScenario[] = await enrichChainMacs(
	buildScenarios(rawScenarios as RawScenario[]),
);
