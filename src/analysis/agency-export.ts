import { RESOURCE_KIND_TABLE, type ResourceKind } from "../packet/types.ts";
import type { AnalysisResult } from "./api.ts";
import type { EventCluster } from "./event-queue.ts";
import {
	osmTagsForQueueKind,
	receiverTagsForPersonFlag,
	receiverTagsForResource,
} from "./interoperability.ts";
import { restrictedCount } from "./privacy.ts";

export const AGENCY_PROFILE_TABLE = [
	"township",
	"county",
	"central",
	"rescue",
	"social",
	"partner",
	"lifeline",
	"healthcare",
] as const;

export type AgencyProfile = (typeof AGENCY_PROFILE_TABLE)[number];
export const COORD_RESOLUTION_TABLE = [0, 1, 2, 3, 4] as const;
export type CoordResolution = (typeof COORD_RESOLUTION_TABLE)[number];
export const DEFAULT_COORD_RESOLUTION: CoordResolution = 2;

export interface AgencyExportOptions {
	readonly coord_resolution?: CoordResolution;
}

export interface AgencyExportSection {
	readonly id: string;
	readonly title: string;
	readonly rows: readonly Record<string, string | number | boolean>[];
}

export interface AgencyExport {
	readonly profile: AgencyProfile;
	readonly generated_at: string;
	readonly sections: readonly AgencyExportSection[];
	readonly note: string;
	readonly coord_resolution: CoordResolution;
	readonly semantic_verification: AnalysisResult["semantic_verification"];
}

const NOTE =
	"Fact export only; not an evacuation, dispatch, route, or case-management decision.";
type TrackedNeedFlag = keyof AnalysisResult["summary"]["flag_totals"];
const SOCIAL_DIRECT_FLAGS: readonly TrackedNeedFlag[] = ["trapped"];
const SOCIAL_WELFARE_FLAGS: readonly TrackedNeedFlag[] = [
	"special_needs",
	"long_term_care",
	"requires_separated_space",
];
const SOCIAL_NONLOCAL_FLAGS: readonly TrackedNeedFlag[] = [
	"foreign_visitor",
	"migrant_worker",
];
const HEALTHCARE_DIRECT_FLAGS: readonly TrackedNeedFlag[] = ["injured"];
const HEALTHCARE_CARE_FLAGS: readonly TrackedNeedFlag[] = [
	"special_needs",
	"long_term_care",
];

/**
 * Build role-shaped exports from one analysis result. Profiles are static data
 * slices, not authentication or authorization; integrators can enforce access in
 * their own systems while this component remains small and forkable.
 */
export const buildAgencyExport = (
	result: AnalysisResult,
	profile: AgencyProfile,
	options: AgencyExportOptions = {},
): AgencyExport => {
	const coord_resolution = options.coord_resolution ?? DEFAULT_COORD_RESOLUTION;
	return {
		profile,
		generated_at: result.analysed_at,
		note: NOTE,
		coord_resolution,
		semantic_verification: result.semantic_verification,
		sections: sectionsFor(result, profile, coord_resolution),
	};
};

export const toAgencyCsv = (exportData: AgencyExport): string => {
	const rows = exportData.sections.flatMap((section) =>
		section.rows.map((row) => csvRow(exportData.profile, section.id, row)),
	);
	return `\ufeff${["profile,section,area,cluster_id,kind,status,count,max_severity,latest_ts", ...rows].join("\n")}`;
};

/** Choose the minimal profile sections first, then apply coordinate rounding only to queue rows. */
const sectionsFor = (
	result: AnalysisResult,
	profile: AgencyProfile,
	coord_resolution: CoordResolution,
): readonly AgencyExportSection[] => {
	if (profile === "partner")
		return [resourceRequests(result), resourceOffers(result)];
	if (profile === "lifeline")
		return [
			queueSection(result, coord_resolution, lifelineCluster),
			resourceRequests(result, lifelineResource),
			resourceOffers(result, lifelineResource),
		];
	if (profile === "healthcare")
		return [
			healthcareNeedsFlags(result),
			resourceRequests(result, healthcareResource),
		];
	if (profile === "social")
		return [socialNeedsFlags(result), resourceRequests(result)];
	if (profile === "rescue")
		return [
			queueSection(result, coord_resolution, rescueCluster),
			hintsSection(result),
		];
	if (profile === "county" || profile === "central")
		return [
			queueSection(result, coord_resolution),
			hintsSection(result),
			alertsSection(result),
			summarySection(result),
		];
	return [
		queueSection(result, coord_resolution),
		alertsSection(result),
		summarySection(result),
	];
};

/** Event queue rows carry rounded centroids; CSV projection later drops them by fixed header. */
const queueSection = (
	result: AnalysisResult,
	coord_resolution: CoordResolution,
	filter: (cluster: EventCluster) => boolean = () => true,
): AgencyExportSection => ({
	id: "event_queue",
	title: "Event queue clusters",
	rows: result.event_queue.groups.flatMap((group) =>
		group.clusters
			.filter(filter)
			.map((cluster) => queueRow(group, cluster, coord_resolution)),
	),
});

const alertsSection = (result: AnalysisResult): AgencyExportSection => ({
	id: "alerts",
	title: "Alerts",
	rows: result.alerts.map((alert) => ({
		alert_id: alert.id,
		severity: alert.severity,
		message: alert.message,
		refs: alert.refs.join("|"),
	})),
});

const hintsSection = (result: AnalysisResult): AgencyExportSection => ({
	id: "review_hints",
	title: "Review hints",
	rows: result.event_queue.hints.map((hint) => ({
		area: hint.adminAreaKey,
		type: hint.type,
		cluster_id: hint.clusterIds.join("|"),
		message: hint.message,
	})),
});

const summarySection = (result: AnalysisResult): AgencyExportSection => ({
	id: "summary",
	title: "Aggregate summary",
	rows: [
		{ metric: "packet_count", value: result.summary.packet_count },
		{
			metric: "village_count",
			value: Object.keys(result.summary.village_counts).length,
		},
		{
			metric: "terrain_event_count",
			value: result.summary.terrain_events.length,
		},
	],
});

/**
 * Social exports keep urgent operational flags exact, then group identity,
 * welfare, and privacy proxies into bucketed support signals so small villages
 * do not receive a row naming one sensitive status.
 */
const socialNeedsFlags = (result: AnalysisResult): AgencyExportSection => ({
	id: "needs_flags",
	title: "Social and health needs flags",
	rows: [
		...directNeedsRows(result, SOCIAL_DIRECT_FLAGS),
		...groupedNeedRows(result, [
			["restricted_welfare_support", SOCIAL_WELFARE_FLAGS],
			["language_or_nonlocal_support", SOCIAL_NONLOCAL_FLAGS],
		]),
	],
});

/**
 * Healthcare exports expose injury as an immediate medical signal but collapse
 * evacuation-support, continuity, and accessibility flags into one bucketed
 * support row.
 */
const healthcareNeedsFlags = (result: AnalysisResult): AgencyExportSection => ({
	id: "needs_flags",
	title: "Social and health needs flags",
	rows: [
		...directNeedsRows(result, HEALTHCARE_DIRECT_FLAGS),
		...groupedNeedRows(result, [
			["care_continuity_support", HEALTHCARE_CARE_FLAGS],
		]),
	],
});

const resourceRequests = (
	result: AnalysisResult,
	allowed: (resource: ResourceKind) => boolean = () => true,
): AgencyExportSection => ({
	id: "resource_requests",
	title: "Resource requests",
	rows: resourceRows(
		result.summary.resource_requests,
		result.summary.urgent_resource_requests,
		allowed,
	),
});

const resourceOffers = (
	result: AnalysisResult,
	allowed: (resource: ResourceKind) => boolean = () => true,
): AgencyExportSection => ({
	id: "resource_offers",
	title: "Resource offers",
	rows: resourceRows(
		result.summary.resource_offers,
		emptyResourceCounts(),
		allowed,
	),
});

const resourceRows = (
	requests: Record<ResourceKind, number>,
	urgent: Record<ResourceKind, number>,
	allowed: (resource: ResourceKind) => boolean = () => true,
) =>
	(Object.entries(requests) as [ResourceKind, number][])
		.filter(([resource, value]) => value > 0 && allowed(resource))
		.map(([resource, quantity]) => resourceRow(resource, quantity, urgent));

/**
 * Keep queue rows as scalar export records while adding only mapper-review
 * hints. CSV projection ignores this JSON-only field, preserving spreadsheet
 * compatibility for existing agency consumers.
 */
const queueRow = (
	group: { readonly adminAreaKey: string },
	cluster: EventCluster,
	coord_resolution: CoordResolution,
) => {
	const centroid = roundedCentroid(cluster, coord_resolution);
	const row = {
		area: group.adminAreaKey,
		cluster_id: cluster.id,
		kind: cluster.kind,
		status: cluster.status,
		count: cluster.count,
		max_severity: cluster.maxSeverity,
		latest_ts: cluster.latestTs,
		lat: centroid.lat,
		lng: centroid.lng,
		coord_resolution,
	};
	const osmTags = osmTagsForQueueKind(cluster.kind, cluster.maxSeverity);
	return osmTags === undefined ? row : { ...row, osm_tags_proposed: osmTags };
};

const roundedCentroid = (
	cluster: EventCluster,
	coord_resolution: CoordResolution,
) => ({
	lat: roundCoordinate(cluster.centroid.lat, coord_resolution),
	lng: roundCoordinate(cluster.centroid.lng, coord_resolution),
});

const roundCoordinate = (value: number, decimals: CoordResolution): number => {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
};

const needsFlagRow = (flag: string, count: number) => {
	const receiverTags = receiverTagsForPersonFlag(flag);
	return receiverTags === undefined
		? { flag, count }
		: { flag, count, receiver_tags: receiverTags };
};

/** Preserve exact counts only for flags intentionally allowed to remain named. */
const directNeedsRows = (
	result: AnalysisResult,
	flags: readonly TrackedNeedFlag[],
): readonly Record<string, string | number>[] =>
	flags.flatMap((flag) => {
		const count = result.summary.flag_totals[flag] ?? 0;
		return count > 0 ? [needsFlagRow(flag, count)] : [];
	});

/** Combine proxy flags into support categories, then bucket small counts. */
const groupedNeedRows = (
	result: AnalysisResult,
	groups: readonly (readonly [string, readonly TrackedNeedFlag[]])[],
): readonly Record<string, string | number>[] =>
	groups.flatMap(([flag, flags]) => {
		const count = flags.reduce(
			(total, item) => total + (result.summary.flag_totals[item] ?? 0),
			0,
		);
		return count > 0 ? [{ flag, count: restrictedCount(count) }] : [];
	});

/**
 * Resource rows mirror urgency as receiver hint tag modifiers only for systems
 * that consume the JSON hint; packet vocabulary and CSV projection stay stable.
 */
const resourceRow = (
	resource: ResourceKind,
	quantity: number,
	urgent: Record<ResourceKind, number>,
) => {
	const isUrgent = urgent[resource] > 0;
	const row = { resource, quantity, urgent: isUrgent };
	const receiverTags = receiverTagsForResource(resource, isUrgent);
	return receiverTags === undefined
		? row
		: { ...row, receiver_tags: receiverTags };
};

const rescueCluster = (cluster: EventCluster): boolean =>
	cluster.kind === "person_report:rescue_needed" ||
	cluster.kind === "person_report:address_lost" ||
	cluster.kind.startsWith("terrain_event:");

const lifelineCluster = (cluster: EventCluster): boolean =>
	cluster.kind === "terrain_event:power_outage_area" ||
	cluster.kind === "terrain_event:signal_lost" ||
	cluster.kind === "terrain_event:road_blocked" ||
	cluster.kind === "terrain_event:bridge_collapsed";

const lifelineResource = (resource: ResourceKind): boolean =>
	resource === "communication" ||
	resource === "power_generator" ||
	resource === "fuel" ||
	resource === "vehicle_transport";

const healthcareResource = (resource: ResourceKind): boolean =>
	resource === "medical_aid";

const emptyResourceCounts = (): Record<ResourceKind, number> =>
	Object.fromEntries(RESOURCE_KIND_TABLE.map((kind) => [kind, 0])) as Record<
		ResourceKind,
		number
	>;

const csvRow = (
	profile: AgencyProfile,
	section: string,
	row: Record<string, string | number | boolean>,
): string =>
	[
		profile,
		section,
		row.area ?? "",
		row.cluster_id ?? "",
		row.kind ?? row.type ?? row.resource ?? row.flag ?? row.metric ?? "",
		row.status ?? "",
		row.count ?? row.quantity ?? row.value ?? "",
		row.max_severity ?? "",
		row.latest_ts ?? "",
	]
		.map(csvCell)
		.join(",");

const csvCell = (value: string | number | boolean): string => {
	const text = escapeSpreadsheetFormula(String(value));
	return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const escapeSpreadsheetFormula = (text: string): string =>
	/^[=+\-@]/.test(text) ? `'${text}` : text;
