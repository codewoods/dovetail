import * as v from "valibot";
import {
	type PacketJson,
	PERSON_FLAG_TABLE,
	PERSON_STATUS_TABLE,
	RESOURCE_FLAG_TABLE,
	RESOURCE_KIND_TABLE,
	TERRAIN_EVENT_TABLE,
	TERRAIN_FLAG_TABLE,
} from "./types.ts";

export const MAX_PACKET_BATCH = 200;
export const MAX_PACKET_BODY_BYTES = 64 * 1024;

type ValidationResult =
	| { ok: true; packets: PacketJson[] }
	| { ok: false; error: string };

const U32_MAX = 0xffffffff;

const MacSchema = v.pipe(v.string(), v.regex(/^[0-9a-fA-F]{12}$/));

// Envelope chain_mac per spec §8.1.2: HMAC-SHA-256 hex (32 bytes → 64 chars).
// Shape lock filters broken/garbage envelopes before they reach aggregation;
// cryptographic forgery (a random 64-hex string that does not verify under the
// gateway key) is intentionally **not** detected here — value verification
// belongs to the production gateway HMAC path (spec §8) and is out of MVP scope.
const ChainMacSchema = v.pipe(v.string(), v.regex(/^[0-9a-fA-F]{64}$/));

const Uint32 = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(0),
	v.maxValue(U32_MAX),
);

const BoundedString = (max: number) =>
	v.pipe(v.string(), v.minLength(1), v.maxLength(max));

const Latitude = v.pipe(v.number(), v.minValue(-90), v.maxValue(90));
const Longitude = v.pipe(v.number(), v.minValue(-180), v.maxValue(180));

const EnumValue = <T extends string>(table: readonly T[]) =>
	v.picklist(table as readonly [T, ...T[]]);

const EnumArray = <T extends string>(table: readonly T[]) =>
	v.pipe(v.array(EnumValue(table)), v.maxLength(table.length));

// AEAD profile pinned to the two AES-128 variants used by web/worker (GCM) and hardware profiles (CCM).
const EnvelopeSchema = v.object({
	received_at: v.pipe(
		BoundedString(40),
		v.check(
			(s) => !Number.isNaN(Date.parse(s)),
			"received_at must parse as Date",
		),
	),
	gateway_id: BoundedString(64),
	aead_profile: v.picklist(["aead-gcm-128", "aead-ccm-128"] as const),
	chain_mac: ChainMacSchema,
});

// Person reports imply identified people; bound every numeric range and pin status/flag vocabulary
// so cross-type field confusion cannot reach aggregation or alert rules downstream.
const PersonPacketSchema = v.object({
	mac: MacSchema,
	village: Uint32,
	ts: Uint32,
	lat: Latitude,
	lng: Longitude,
	alt: v.pipe(v.number(), v.integer(), v.minValue(-500), v.maxValue(9000)),
	addr: BoundedString(64),
	count: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(255)),
	status: EnumValue(PERSON_STATUS_TABLE),
	flags: EnumArray(PERSON_FLAG_TABLE),
});

const TerrainPacketSchema = v.object({
	mac: MacSchema,
	ts: Uint32,
	lat: Latitude,
	lng: Longitude,
	event: EnumValue(TERRAIN_EVENT_TABLE),
	extent_m: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(0xffff)),
	severity: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(255)),
	flags: EnumArray(TERRAIN_FLAG_TABLE),
});

const ResourcePacketSchema = v.object({
	mac: MacSchema,
	ts: Uint32,
	lat: Latitude,
	lng: Longitude,
	addr: BoundedString(64),
	resource: EnumArray(RESOURCE_KIND_TABLE),
	quantity: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(255)),
	duration: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(255)),
	flags: EnumArray(RESOURCE_FLAG_TABLE),
});

// Discriminate on `type` before applying packet-shape schema; valibot variant maps each tag to
// its strict shape so malformed JSON cannot bypass per-type guards.
const PacketJsonSchema = v.variant("type", [
	v.object({
		type: v.literal("person_report"),
		envelope: EnvelopeSchema,
		packet: PersonPacketSchema,
	}),
	v.object({
		type: v.literal("terrain_event"),
		envelope: EnvelopeSchema,
		packet: TerrainPacketSchema,
	}),
	v.object({
		type: v.literal("resource_report"),
		envelope: EnvelopeSchema,
		packet: ResourcePacketSchema,
	}),
]);

const PacketBatchSchema = v.pipe(
	v.array(PacketJsonSchema),
	v.maxLength(MAX_PACKET_BATCH),
);

export const validatePacketBatch = (value: unknown): ValidationResult => {
	if (!Array.isArray(value)) return { ok: false, error: "expected_array" };
	if (value.length > MAX_PACKET_BATCH)
		return { ok: false, error: "batch_too_large" };
	const result = v.safeParse(PacketBatchSchema, value);
	if (!result.success) return { ok: false, error: "invalid_packet_schema" };
	return { ok: true, packets: result.output as PacketJson[] };
};
