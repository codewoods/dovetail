import { ADDR_SIZE, decodeAddr, encodeAddr } from "./addr.ts";

export const COORD_SCALE = 1e7;

export const writeMac = (
	view: DataView,
	offset: number,
	mac: Uint8Array,
): void => {
	for (let i = 0; i < 6; i++) view.setUint8(offset + i, mac[i] ?? 0);
};

export const readMac = (view: DataView, offset: number): string => {
	let out = "";
	for (let i = 0; i < 6; i++)
		out += view
			.getUint8(offset + i)
			.toString(16)
			.padStart(2, "0")
			.toUpperCase();
	return out;
};

export const writeAddr = (
	view: DataView,
	offset: number,
	addr: string,
): void => {
	const bytes = encodeAddr(addr);
	for (let i = 0; i < ADDR_SIZE; i++) view.setUint8(offset + i, bytes[i] ?? 0);
};

export const readAddr = (view: DataView, offset: number): string => {
	const buf = new Uint8Array(ADDR_SIZE);
	for (let i = 0; i < ADDR_SIZE; i++) buf[i] = view.getUint8(offset + i);
	return decodeAddr(buf);
};

export const flagsToBitmap = (
	flags: readonly string[],
	table: readonly string[],
): number =>
	flags.reduce((bits, flag) => {
		const idx = table.indexOf(flag);
		return idx >= 0 ? bits | (1 << idx) : bits;
	}, 0) & 0xffff;

export const bitmapToFlags = <T extends string>(
	bits: number,
	table: readonly T[],
): T[] => table.filter((value, index) => Boolean(value && (bits >> index) & 1));
