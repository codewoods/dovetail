/**
 * Binary codec for the three packet types defined in SPEC.md §4.
 *
 * Encryption profile (call-component MVP): AES-128-GCM via Web Crypto with
 * a 32-bit truncated tag (`tagLength: 32`). Compatible hardware profiles can
 * use AES-128-CCM with the same 32-bit tag length so the wire format is profile-agnostic.
 *
 * Wire layout:
 *   byte 0       = type (AAD, not encrypted)
 *   bytes 1..N-1 = ciphertext (= plaintext encrypted under AEAD with type as AAD)
 *   tag attached at the tail of the ciphertext by Web Crypto.
 * The same type byte is also folded into the nonce reserved byte so per-type
 * firmware counters cannot collide across packet classes.
 *
 * Plaintext layout matches SPEC §4 verbatim; this module is the single source
 * of truth that hardware profile adapters and the analysis component must
 * agree with.
 */
import {
	aeadOpen,
	aeadSeal,
	buildNonce,
	importKey,
	keyFromHex,
	parseHex,
} from "./codec-core.ts";
import {
	bitmapToFlags,
	COORD_SCALE,
	flagsToBitmap,
	readAddr,
	readMac,
	writeAddr,
	writeMac,
} from "./codec-layout.ts";
import {
	PERSON_FLAG_TABLE,
	PERSON_STATUS_TABLE,
	type PersonFlag,
	type PersonReportPacket,
	RESOURCE_FLAG_TABLE,
	RESOURCE_KIND_TABLE,
	type ResourceFlag,
	type ResourceKind,
	type ResourceReportPacket,
	TERRAIN_EVENT_TABLE,
	TERRAIN_FLAG_TABLE,
	type TerrainEventPacket,
	type TerrainFlag,
} from "./types.ts";

export const PERSON_REPORT_SIZE = 40;
export const TERRAIN_EVENT_SIZE = 29;
export const RESOURCE_REPORT_SIZE = 36;

export const TYPE_PERSON_REPORT = 0x01;
export const TYPE_TERRAIN_EVENT = 0x02;
export const TYPE_RESOURCE_REPORT = 0x03;

export interface CodecKey {
	/** 16 bytes raw key material (AES-128). */
	raw: Uint8Array;
}

interface Coordinates {
	lat: number;
	lng: number;
}

interface EncodeReportInput {
	type: number;
	plaintextSize: number;
	mac: string;
	key: CryptoKey;
	counter: number;
	writeFields: (view: DataView) => void;
}

interface ReportPayloadCodec<Packet extends { mac: string }> {
	type: number;
	plaintextSize: number;
	writeFields: (view: DataView, packet: Packet) => void;
}

interface OpenReportInput {
	expectedType: number;
	frame: Uint8Array;
	key: CryptoKey;
	counter: number;
	macHint: Uint8Array;
	expectedSize: number;
}

const payloadView = (payload: Uint8Array): DataView =>
	new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

/**
 * Packet encoders share MAC/counter/type nonce derivation and AEAD framing; the
 * caller only supplies packet-specific plaintext fields.
 */
const encodeReportPayload = async ({
	type,
	plaintextSize,
	mac,
	key,
	counter,
	writeFields,
}: EncodeReportInput): Promise<Uint8Array> => {
	const plaintext = new Uint8Array(plaintextSize);
	const view = payloadView(plaintext);
	const macBytes = parseHex(mac, 6);
	writeMac(view, 0, macBytes);
	writeFields(view);
	return aeadSeal(type, plaintext, key, buildNonce(macBytes, counter, type));
};

/**
 * Public encoders differ only by packet layout; this factory keeps their wire
 * framing identical while preserving packet-specific TypeScript input types.
 */
const makeReportEncoder =
	<Packet extends { mac: string }>({
		type,
		plaintextSize,
		writeFields,
	}: ReportPayloadCodec<Packet>) =>
	(packet: Packet, key: CryptoKey, counter: number): Promise<Uint8Array> =>
		encodeReportPayload({
			type,
			plaintextSize,
			mac: packet.mac,
			key,
			counter,
			writeFields: (view) => writeFields(view, packet),
		});

/** Decoder setup mirrors encoding so every packet type validates size/type first. */
const openReportView = async ({
	expectedType,
	frame,
	key,
	counter,
	macHint,
	expectedSize,
}: OpenReportInput): Promise<DataView> =>
	payloadView(
		await aeadOpen({
			expectedType,
			frame,
			key,
			nonce: buildNonce(macHint, counter, expectedType),
			expectedSize,
		}),
	);

const writeCoordinates = (
	view: DataView,
	offset: number,
	coordinates: Coordinates,
): void => {
	view.setInt32(offset, Math.round(coordinates.lat * COORD_SCALE), true);
	view.setInt32(offset + 4, Math.round(coordinates.lng * COORD_SCALE), true);
};

const readCoordinates = (view: DataView, offset: number): Coordinates => ({
	lat: view.getInt32(offset, true) / COORD_SCALE,
	lng: view.getInt32(offset + 4, true) / COORD_SCALE,
});

/** Write only person-specific fields; MAC and AEAD framing are shared helpers. */
const writePersonFields = (
	view: DataView,
	packet: PersonReportPacket,
): void => {
	view.setUint32(6, packet.village >>> 0, true);
	view.setUint32(10, packet.ts >>> 0, true);
	writeCoordinates(view, 14, packet);
	view.setInt16(22, packet.alt, true);
	writeAddr(view, 24, packet.addr);
	view.setUint8(31, packet.count & 0xff);
	view.setUint8(32, PERSON_STATUS_TABLE.indexOf(packet.status));
	view.setUint16(33, flagsToBitmap(packet.flags, PERSON_FLAG_TABLE), true);
};

/** Terrain payloads omit address data but keep coordinates in the common scale. */
const writeTerrainFields = (
	view: DataView,
	packet: TerrainEventPacket,
): void => {
	view.setUint32(6, packet.ts >>> 0, true);
	writeCoordinates(view, 10, packet);
	view.setUint8(18, TERRAIN_EVENT_TABLE.indexOf(packet.event) + 1);
	view.setUint16(19, packet.extent_m & 0xffff, true);
	view.setUint8(21, packet.severity & 0xff);
	view.setUint16(22, flagsToBitmap(packet.flags, TERRAIN_FLAG_TABLE), true);
};

/** Resource reports share location fields with terrain plus address and bitmaps. */
const writeResourceFields = (
	view: DataView,
	packet: ResourceReportPacket,
): void => {
	view.setUint32(6, packet.ts >>> 0, true);
	writeCoordinates(view, 10, packet);
	writeAddr(view, 18, packet.addr);
	view.setUint16(25, flagsToBitmap(packet.resource, RESOURCE_KIND_TABLE), true);
	view.setUint8(27, packet.quantity & 0xff);
	view.setUint8(28, packet.duration & 0xff);
	view.setUint16(29, flagsToBitmap(packet.flags, RESOURCE_FLAG_TABLE), true);
};

/** Encode + encrypt a person_report packet into 40 bytes. */
export const encodePersonReport = makeReportEncoder<PersonReportPacket>({
	type: TYPE_PERSON_REPORT,
	plaintextSize: 35,
	writeFields: writePersonFields,
});

/** Decrypt + decode a 40-byte person_report frame back into a PersonReportPacket. */
export const decodePersonReport = async (
	frame: Uint8Array,
	key: CryptoKey,
	counter: number,
	macHint: Uint8Array,
): Promise<PersonReportPacket> => {
	const view = await openReportView({
		expectedType: TYPE_PERSON_REPORT,
		frame,
		key,
		counter,
		macHint,
		expectedSize: PERSON_REPORT_SIZE,
	});
	const mac = readMac(view, 0);
	const village = view.getUint32(6, true);
	const ts = view.getUint32(10, true);
	const { lat, lng } = readCoordinates(view, 14);
	const alt = view.getInt16(22, true);
	const addr = readAddr(view, 24);
	const count = view.getUint8(31);
	const statusIndex = view.getUint8(32);
	const status = PERSON_STATUS_TABLE[statusIndex] ?? "unknown";
	const flags = bitmapToFlags<PersonFlag>(
		view.getUint16(33, true),
		PERSON_FLAG_TABLE,
	);
	return {
		mac,
		village,
		ts,
		lat,
		lng,
		alt,
		addr,
		count,
		status,
		flags,
	};
};

/** Encode + encrypt a terrain_event packet into 29 bytes. */
export const encodeTerrainEvent = makeReportEncoder<TerrainEventPacket>({
	type: TYPE_TERRAIN_EVENT,
	plaintextSize: 24,
	writeFields: writeTerrainFields,
});

/** Decrypt + decode a 29-byte terrain_event frame. */
export const decodeTerrainEvent = async (
	frame: Uint8Array,
	key: CryptoKey,
	counter: number,
	macHint: Uint8Array,
): Promise<TerrainEventPacket> => {
	const view = await openReportView({
		expectedType: TYPE_TERRAIN_EVENT,
		frame,
		key,
		counter,
		macHint,
		expectedSize: TERRAIN_EVENT_SIZE,
	});
	const mac = readMac(view, 0);
	const ts = view.getUint32(6, true);
	const { lat, lng } = readCoordinates(view, 10);
	const eventIndex = view.getUint8(18);
	const event = TERRAIN_EVENT_TABLE[eventIndex - 1];
	if (!event) throw new RangeError(`unknown terrain event index ${eventIndex}`);
	const extent_m = view.getUint16(19, true);
	const severity = view.getUint8(21);
	const flags = bitmapToFlags<TerrainFlag>(
		view.getUint16(22, true),
		TERRAIN_FLAG_TABLE,
	);
	return {
		mac,
		ts,
		lat,
		lng,
		event,
		extent_m,
		severity,
		flags,
	};
};

/** Encode + encrypt a resource_report packet into 36 bytes. */
export const encodeResourceReport = makeReportEncoder<ResourceReportPacket>({
	type: TYPE_RESOURCE_REPORT,
	plaintextSize: 31,
	writeFields: writeResourceFields,
});

/** Decrypt + decode a 36-byte resource_report frame. */
export const decodeResourceReport = async (
	frame: Uint8Array,
	key: CryptoKey,
	counter: number,
	macHint: Uint8Array,
): Promise<ResourceReportPacket> => {
	const view = await openReportView({
		expectedType: TYPE_RESOURCE_REPORT,
		frame,
		key,
		counter,
		macHint,
		expectedSize: RESOURCE_REPORT_SIZE,
	});
	const mac = readMac(view, 0);
	const ts = view.getUint32(6, true);
	const { lat, lng } = readCoordinates(view, 10);
	const addr = readAddr(view, 18);
	const resource = bitmapToFlags<ResourceKind>(
		view.getUint16(25, true),
		RESOURCE_KIND_TABLE,
	);
	const quantity = view.getUint8(27);
	const duration = view.getUint8(28);
	const flags = bitmapToFlags<ResourceFlag>(
		view.getUint16(29, true),
		RESOURCE_FLAG_TABLE,
	);
	return { mac, ts, lat, lng, addr, resource, quantity, duration, flags };
};

export { buildNonce, importKey, keyFromHex };
