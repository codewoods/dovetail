/**
 * Core codec primitives live here so packet-specific layouts can stay focused
 * on field mapping instead of crypto and binary framing details.
 */
const AEAD_TAG_BITS = 32;

export interface AeadOpenInput {
	expectedType: number;
	frame: Uint8Array;
	key: CryptoKey;
	nonce: Uint8Array;
	expectedSize: number;
}

export const importKey = async (raw: Uint8Array): Promise<CryptoKey> => {
	if (raw.length !== 16)
		throw new RangeError(`AES-128 key must be 16 bytes, got ${raw.length}`);
	return crypto.subtle.importKey(
		"raw",
		raw as Uint8Array<ArrayBuffer>,
		{ name: "AES-GCM" },
		false,
		["encrypt", "decrypt"],
	);
};

/**
 * Build a 12-byte nonce as device_mac(6) || packet_counter(4) || packet_type(1)
 * || reserved(1). The counter is little-endian to match packet encoding, and
 * the type byte separates packet classes that may share a per-type counter.
 */
export const buildNonce = (
	mac: Uint8Array,
	counter: number,
	packetType: number,
): Uint8Array => {
	if (mac.length !== 6) throw new RangeError("mac must be 6 bytes");
	if (!Number.isInteger(counter) || counter < 0 || counter > 0xffffffff)
		throw new RangeError("counter must be an unsigned 32-bit integer");
	if (!Number.isInteger(packetType) || packetType < 0 || packetType > 0xff)
		throw new RangeError("packet type must be an unsigned 8-bit integer");
	const nonce = new Uint8Array(12);
	nonce.set(mac, 0);
	new DataView(nonce.buffer).setUint32(6, counter, true);
	nonce[10] = packetType;
	return nonce;
};

/**
 * Parse fixed-width hex so packet identifiers fail before crypto is attempted.
 * Errors never echo the input string because parseHex is also called via
 * keyFromHex on the AES key material; surfacing a malformed key through an
 * HTTP error body would leak partial secret bytes to the client.
 */
export const parseHex = (input: string, byteLen: number): Uint8Array => {
	const cleaned = input.replace(/[^0-9a-fA-F]/g, "");
	if (cleaned.length !== byteLen * 2)
		throw new RangeError(`hex input must decode to ${byteLen} bytes`);
	const out = new Uint8Array(byteLen);
	for (let i = 0; i < byteLen; i++)
		out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
	return out;
};

/**
 * Seal plaintext as type || ciphertext || tag, binding the type byte as AAD so
 * a valid encrypted payload cannot be replayed as another packet class.
 */
export const aeadSeal = async (
	type: number,
	plaintext: Uint8Array,
	key: CryptoKey,
	nonce: Uint8Array,
): Promise<Uint8Array> => {
	const aad = new Uint8Array([type]);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{
				name: "AES-GCM",
				iv: nonce as Uint8Array<ArrayBuffer>,
				additionalData: aad as Uint8Array<ArrayBuffer>,
				tagLength: AEAD_TAG_BITS,
			},
			key,
			plaintext as Uint8Array<ArrayBuffer>,
		),
	);
	const frame = new Uint8Array(1 + ciphertext.length);
	frame[0] = type;
	frame.set(ciphertext, 1);
	return frame;
};

/** Validate framing before decrypting so callers get deterministic codec errors. */
export const aeadOpen = async ({
	expectedType,
	frame,
	key,
	nonce,
	expectedSize,
}: AeadOpenInput): Promise<Uint8Array> => {
	if (frame.length !== expectedSize)
		throw new RangeError(
			`expected ${expectedSize} byte frame, got ${frame.length}`,
		);
	if (frame[0] !== expectedType)
		throw new RangeError(
			`type byte ${frame[0]?.toString(16)} ≠ expected ${expectedType.toString(16)}`,
		);
	const aad = new Uint8Array([expectedType]);
	const plaintext = await crypto.subtle.decrypt(
		{
			name: "AES-GCM",
			iv: nonce as Uint8Array<ArrayBuffer>,
			additionalData: aad as Uint8Array<ArrayBuffer>,
			tagLength: AEAD_TAG_BITS,
		},
		key,
		frame.subarray(1) as Uint8Array<ArrayBuffer>,
	);
	return new Uint8Array(plaintext);
};

/** Utility for tests / demos: deterministic key derivation from a hex string. */
export const keyFromHex = async (hex: string): Promise<CryptoKey> =>
	importKey(parseHex(hex, 16));
