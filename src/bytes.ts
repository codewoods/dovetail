export const hexToBytes = (hex: string): Uint8Array =>
	Uint8Array.from(hex.replace(/[^0-9a-fA-F]/g, "").match(/../g) ?? [], (byte) =>
		parseInt(byte, 16),
	);

export const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Concatenate byte chunks once so callers keep binary field ordering explicit. */
export const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
	const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(totalLength);
	parts.reduce((offset, part) => {
		out.set(part, offset);
		return offset + part.length;
	}, 0);
	return out;
};
