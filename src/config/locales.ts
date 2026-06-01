import {
	LABELS_BY_LOCALE,
	type LocaleCode,
	type LocaleLabels,
} from "../demo/labels.ts";

export interface LoadedLocaleBundle {
	readonly locale: LocaleCode;
	readonly labels: LocaleLabels;
	readonly warnings: readonly string[];
}

const REQUIRED_SECTIONS = [
	"status",
	"person_flag",
	"terrain_event",
	"terrain_flag",
	"resource",
	"resource_flag",
	"queue",
	"severity_bands",
	"severity_scale",
] as const;

/**
 * Validate operator-editable locale JSON. Locale edits are all-or-default by
 * design: partial translations are more dangerous for field users than falling
 * back to the bundled, tested labels.
 */
export const loadLocaleBundle = (
	locale: LocaleCode,
	input: unknown,
): LoadedLocaleBundle => {
	const fallback = LABELS_BY_LOCALE[locale];
	if (!isRecord(input))
		return {
			locale,
			labels: fallback,
			warnings: [`locale ${locale} ignored: expected object`],
		};
	const missing = REQUIRED_SECTIONS.filter((section) => !(section in input));
	if (missing.length > 0) {
		return {
			locale,
			labels: fallback,
			warnings: missing.map(
				(section) => `locale ${locale} ignored: missing section ${section}`,
			),
		};
	}
	return { locale, labels: input as unknown as LocaleLabels, warnings: [] };
};

const isRecord = (input: unknown): input is Record<string, unknown> =>
	typeof input === "object" && input !== null && !Array.isArray(input);
