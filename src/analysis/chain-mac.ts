import { bytesToHex, concatBytes, hexToBytes } from "../bytes.ts";

export interface ChainMacInput {
	gatewayKey: Uint8Array;
	previousChainMac: string;
	packetHeader: Uint8Array;
	ciphertext: Uint8Array;
	aeadTag: Uint8Array;
	receivedAt: string;
	gatewayId: string;
}

const encoder = new TextEncoder();
// Prefix each field with its byte length so adjacent variable-length fields
// cannot be reinterpreted as a different boundary split.
const lengthPrefix = (bytes: Uint8Array): Uint8Array => {
	const framed = new Uint8Array(4 + bytes.length);
	new DataView(framed.buffer).setUint32(0, bytes.length, true);
	framed.set(bytes, 4);
	return framed;
};

// Build the exact HMAC input bytes from the canonical chain fields in order.
const frameChainMacPayload = (
	input: Omit<ChainMacInput, "gatewayKey">,
): Uint8Array => {
	const receivedAtBytes = encoder.encode(input.receivedAt);
	const gatewayIdBytes = encoder.encode(input.gatewayId);
	return concatBytes([
		lengthPrefix(hexToBytes(input.previousChainMac)),
		lengthPrefix(input.packetHeader),
		lengthPrefix(input.ciphertext),
		lengthPrefix(input.aeadTag),
		lengthPrefix(receivedAtBytes),
		lengthPrefix(gatewayIdBytes),
	]);
};

/**
 * Compute one gateway audit-chain link. The Worker MVP does not persist replay
 * windows or rotate keys; this pure helper keeps the algorithm executable for
 * tests and future gateway integrations without claiming production storage.
 */
export const computeChainMac = async (
	input: ChainMacInput,
): Promise<string> => {
	const key = await crypto.subtle.importKey(
		"raw",
		input.gatewayKey as Uint8Array<ArrayBuffer>,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const payload = frameChainMacPayload(input);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		payload as Uint8Array<ArrayBuffer>,
	);
	return bytesToHex(new Uint8Array(signature));
};
