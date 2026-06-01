/**
 * 7-byte addr field encoding per SPEC.md §6.
 *
 * Layout: tag(1) || payload(6)
 *
 * Tag categories:
 *   0x00       TGOS standard address  (payload = 6 bytes opaque code, ASCII or binary)
 *   0x10-0x1F  UNKNOWN_*  (payload zero-filled)
 *   0x20-0x2F  NO_ADDRESS_* / TRANSIENT / VEHICLE
 *   0x30-0x3F  short-stay venue codes (CAMPSITE_*, WORKSITE, ARTIST_RESIDENCY, ...)
 *
 * JSON canonical form keeps the human-readable label so analysis-component and
 * Mock UI never see raw bytes; only the codec round-trips through the dictionary.
 */

const TAG_TGOS = 0x00;

const DICTIONARY: Record<string, number> = {
	UNKNOWN_LANDSLIDE: 0x10,
	UNKNOWN_FLOOD: 0x11,
	UNKNOWN_FIRE: 0x12,
	UNKNOWN_COLLAPSE: 0x13,
	NO_ADDRESS_LOCAL: 0x20,
	NO_ADDRESS_EXTERNAL: 0x21,
	TRANSIENT: 0x22,
	VEHICLE: 0x23,
	CAMPSITE_OFFICIAL: 0x30,
	CAMPSITE_WILD: 0x31,
	GROUP_TOUR: 0x32,
	WORKSITE: 0x33,
	ARTIST_RESIDENCY: 0x34,
	FESTIVAL_VENUE: 0x35,
	MOBILE_VENDOR: 0x36,
};

const REVERSE_DICTIONARY: Record<number, string> = Object.fromEntries(
	Object.entries(DICTIONARY).map(([label, tag]) => [tag, label]),
);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const ADDR_SIZE = 7;

/**
 * Encode an addr label into 7 bytes; throws if the value cannot be represented.
 * Non-dictionary labels are stored as a 6-byte ASCII TGOS payload. UTF-8
 * sequences are rejected (rather than silently byte-truncated) so a multi-byte
 * label like "台北市信義路" never produces a corrupted decode on the receiver.
 */
export const encodeAddr = (label: string): Uint8Array => {
	const out = new Uint8Array(ADDR_SIZE);
	const dictTag = DICTIONARY[label];
	if (dictTag !== undefined) {
		out[0] = dictTag;
		return out;
	}
	const ascii = textEncoder.encode(label);
	if (ascii.length > ADDR_SIZE - 1 || ascii.some((b) => b > 0x7f)) {
		throw new RangeError(
			`TGOS addr "${label}" must be ≤${ADDR_SIZE - 1} ASCII bytes; use a dictionary tag for non-ASCII labels`,
		);
	}
	out[0] = TAG_TGOS;
	out.set(ascii, 1);
	return out;
};

/** Decode a 7-byte addr field back into its canonical label. */
export const decodeAddr = (bytes: Uint8Array): string => {
	if (bytes.length !== ADDR_SIZE)
		throw new RangeError(`addr must be ${ADDR_SIZE} bytes`);
	const tag = bytes[0] ?? 0;
	if (tag === TAG_TGOS)
		return stripTrailingNul(textDecoder.decode(bytes.subarray(1)));
	const label = REVERSE_DICTIONARY[tag];
	if (!label) throw new RangeError(`unknown addr tag 0x${tag.toString(16)}`);
	return label;
};

// TGOS labels are fixed-width and padded with NUL bytes; trim only the trailing
// padding so embedded binary data would still fail loudly instead of being masked.
const stripTrailingNul = (text: string): string => {
	while (text.endsWith("\u0000")) text = text.slice(0, -1);
	return text;
};
