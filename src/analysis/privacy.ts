export const SMALL_RESTRICTED_COUNT = 5;

export type RestrictedCount = number | string;

export const restrictedCount = (count: number): RestrictedCount =>
	count > 0 && count < SMALL_RESTRICTED_COUNT
		? `<${SMALL_RESTRICTED_COUNT}`
		: count;

export const restrictedCountLabel = (count: number): string =>
	String(restrictedCount(count));
