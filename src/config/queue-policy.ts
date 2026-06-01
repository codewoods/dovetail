import queuePolicyJson from "../../config/queue-policy.json";
import {
	PERSON_STATUS_TABLE,
	type PersonStatus,
	RESOURCE_KIND_TABLE,
	TERRAIN_EVENT_TABLE,
} from "../packet/types.ts";

export interface QueuePolicy {
	readonly priorityOrder: readonly string[];
	readonly queuedSeverityThreshold: number;
	readonly clusterRadiusDeg: number;
	readonly personStatusSeverity: Record<PersonStatus, number>;
}

export interface LoadedQueuePolicy {
	readonly policy: QueuePolicy;
	readonly warnings: readonly string[];
}

interface BoundedNumberRule {
	readonly input: unknown;
	readonly min: number;
	readonly max: number;
	readonly fallback: number;
	readonly name: string;
}

export const DEFAULT_QUEUE_POLICY: QueuePolicy = {
	priorityOrder: [
		"person_report:rescue_needed",
		"person_report:address_lost",
		"terrain_event:landslide",
		"terrain_event:drainage_backflow",
		"terrain_event:flood",
		"resource_report:request",
	],
	queuedSeverityThreshold: 80,
	clusterRadiusDeg: 0.003,
	personStatusSeverity: {
		unknown: 140,
		evacuated_shelter: 60,
		evacuated_relatives: 60,
		vertical_evacuated: 60,
		refused: 140,
		rescue_needed: 220,
		self_evacuated_neighbor: 60,
		address_lost: 220,
	},
};

const ALLOWED_KINDS = new Set<string>([
	...PERSON_STATUS_TABLE.map((status) => `person_report:${status}`),
	...TERRAIN_EVENT_TABLE.map((event) => `terrain_event:${event}`),
	...RESOURCE_KIND_TABLE.map((kind) => `resource_report:${kind}`),
	"resource_report:request",
	"resource_report:offer",
]);

/**
 * Validate operator-editable queue policy data. Bad fields fall back to defaults
 * field-by-field so a typo in one local setting cannot break packet ingestion,
 * API output, or the demo page.
 */
export const loadQueuePolicy = (input: unknown): LoadedQueuePolicy => {
	const source = isRecord(input) ? input : {};
	const priority = readPriority(source.priorityOrder);
	const threshold = readBoundedNumber({
		input: source.queuedSeverityThreshold,
		min: 0,
		max: 255,
		fallback: DEFAULT_QUEUE_POLICY.queuedSeverityThreshold,
		name: "queuedSeverityThreshold",
	});
	const radius = readBoundedNumber({
		input: source.clusterRadiusDeg,
		min: 0.0001,
		max: 0.02,
		fallback: DEFAULT_QUEUE_POLICY.clusterRadiusDeg,
		name: "clusterRadiusDeg",
	});
	const severity = readPersonSeverity(source.personStatusSeverity);
	return {
		policy: {
			priorityOrder: priority.value,
			queuedSeverityThreshold: threshold.value,
			clusterRadiusDeg: radius.value,
			personStatusSeverity: severity.value,
		},
		warnings: [
			...priority.warnings,
			...threshold.warnings,
			...radius.warnings,
			...severity.warnings,
		],
	};
};

const readPriority = (
	input: unknown,
): { value: readonly string[]; warnings: readonly string[] } => {
	if (!Array.isArray(input))
		return { value: DEFAULT_QUEUE_POLICY.priorityOrder, warnings: [] };
	return input.reduce<{ value: string[]; warnings: string[] }>(
		(acc, item, index) => {
			if (typeof item === "string" && ALLOWED_KINDS.has(item))
				return { ...acc, value: [...acc.value, item] };
			return {
				...acc,
				warnings: [
					...acc.warnings,
					`priorityOrder[${index}] ignored: unknown queue kind`,
				],
			};
		},
		{ value: [], warnings: [] },
	);
};

/** Numeric policy fields are bounded independently so one bad knob falls back. */
const readBoundedNumber = ({
	input,
	min,
	max,
	fallback,
	name,
}: BoundedNumberRule): { value: number; warnings: readonly string[] } => {
	if (
		typeof input === "number" &&
		Number.isFinite(input) &&
		input >= min &&
		input <= max
	)
		return { value: input, warnings: [] };
	return {
		value: fallback,
		warnings:
			input === undefined ? [] : [`${name} ignored: expected ${min}-${max}`],
	};
};

const readPersonSeverity = (
	input: unknown,
): { value: Record<PersonStatus, number>; warnings: readonly string[] } => {
	if (!isRecord(input))
		return { value: DEFAULT_QUEUE_POLICY.personStatusSeverity, warnings: [] };
	return PERSON_STATUS_TABLE.reduce<{
		value: Record<PersonStatus, number>;
		warnings: string[];
	}>(
		(acc, status) => {
			const next = input[status];
			if (next === undefined) return acc;
			if (
				typeof next === "number" &&
				Number.isInteger(next) &&
				next >= 0 &&
				next <= 255
			) {
				return { ...acc, value: { ...acc.value, [status]: next } };
			}
			return {
				...acc,
				warnings: [
					...acc.warnings,
					`personStatusSeverity.${status} ignored: expected 0-255`,
				],
			};
		},
		{ value: { ...DEFAULT_QUEUE_POLICY.personStatusSeverity }, warnings: [] },
	);
};

const isRecord = (input: unknown): input is Record<string, unknown> =>
	typeof input === "object" && input !== null && !Array.isArray(input);

export const OPERATOR_QUEUE_POLICY = loadQueuePolicy(queuePolicyJson).policy;
