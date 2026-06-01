import type { AggregateSummary } from "./aggregate.ts";
import type { PacketOverlay } from "./overlay.ts";
import { restrictedCountLabel } from "./privacy.ts";

export type AlertSeverity = "info" | "warning" | "critical";

export interface Alert {
	id: string;
	severity: AlertSeverity;
	message: string;
	refs: string[];
}

interface CountAlertInput {
	id: string;
	severity: AlertSeverity;
	count: (summary: AggregateSummary) => number;
	message: (count: string) => string;
	refs: readonly string[];
}

interface EventAlertInput<T> {
	id: string;
	severity: AlertSeverity;
	events: readonly T[];
	message: (count: number) => string;
	refPrefix: string;
}

/** Convert positive aggregate counters into singleton alerts. */
const countAlert = ({
	id,
	severity,
	count,
	message,
	refs,
}: CountAlertInput): ((summary: AggregateSummary) => Alert[]) => {
	return (summary) => {
		const value = count(summary);
		return value > 0
			? [
					{
						id,
						severity,
						message: message(restrictedCountLabel(value)),
						refs: [...refs],
					},
				]
			: [];
	};
};

const countAlerts = (
	summary: AggregateSummary,
	rules: readonly CountAlertInput[],
): Alert[] => rules.flatMap((rule) => countAlert(rule)(summary));

const triageCountAlertRules: readonly CountAlertInput[] = [
	{
		id: "rescue_needed",
		severity: "critical",
		count: (summary) => summary.status_totals.rescue_needed,
		message: (count) => `${count} 人需要救援`,
		refs: ["status_totals.rescue_needed"],
	},
	{
		id: "trapped",
		severity: "critical",
		count: (summary) => summary.flag_totals.trapped,
		message: (count) => `${count} 人受困`,
		refs: ["flag_totals.trapped"],
	},
	{
		id: "address_lost",
		severity: "critical",
		count: (summary) => summary.status_totals.address_lost,
		message: (count) => `${count} 戶原址消失`,
		refs: ["status_totals.address_lost"],
	},
];

const resourceConsentAlertRules: readonly CountAlertInput[] = [
	{
		id: "urgent_warmth_supplies",
		severity: "warning",
		count: (summary) => summary.urgent_resource_requests.warmth_supplies,
		message: (count) => `${count} 份保暖物資 / 枕頭被毯緊急需求`,
		refs: ["urgent_resource_requests.warmth_supplies"],
	},
	{
		id: "urgent_menstrual_supplies",
		severity: "warning",
		count: (summary) => summary.urgent_resource_requests.menstrual_supplies,
		message: (count) => `${count} 份生理用品緊急需求`,
		refs: ["urgent_resource_requests.menstrual_supplies"],
	},
	{
		id: "consent_refused",
		severity: "info",
		count: (summary) => summary.flag_totals.consent_refused,
		message: (count) => `${count} 名當事人拒絕被通報 (status 維持 unknown)`,
		refs: ["flag_totals.consent_refused"],
	},
];

/** Convert filtered event lists into alerts with refs local to that filter. */
const eventAlert = <T>({
	id,
	severity,
	events,
	message,
	refPrefix,
}: EventAlertInput<T>): Alert[] =>
	events.length > 0
		? [
				{
					id,
					severity,
					message: message(events.length),
					refs: events.map((_, i) => `${refPrefix}[${i}]`),
				},
			]
		: [];

/** Person-status alerts stay first because they are command-center triage facts. */
const statusAlerts = (summary: AggregateSummary): Alert[] =>
	countAlerts(summary, triageCountAlertRules);

/** Hazard-zone refs point back to packet indexes, not aggregate counters. */
const hazardZoneAlerts = (overlays: readonly PacketOverlay[]): Alert[] => {
	const inZoneOverlays = overlays.filter((overlay) => overlay.zone.inZone);
	return inZoneOverlays.length > 0
		? [
				{
					id: "packets_in_hazard_zone",
					severity: "warning",
					message: `${inZoneOverlays.length} 筆通報落在已知災害區`,
					refs: inZoneOverlays.map((overlay) => `packets[${overlay.index}]`),
				},
			]
		: [];
};

/** Terrain rules use event-local refs so filtered alert lists remain stable. */
const terrainAlerts = (summary: AggregateSummary): Alert[] => {
	const trappedVehicleEvents = summary.terrain_events.filter((event) =>
		event.flags.includes("vehicles_trapped"),
	);
	const backflowEvents = summary.terrain_events.filter(
		(event) => event.event === "drainage_backflow" && event.severity >= 180,
	);
	return [
		...eventAlert({
			id: "vehicles_trapped",
			severity: "critical",
			events: trappedVehicleEvents,
			message: (count) => `${count} 筆道路事件標記車輛或人員暫時受困`,
			refPrefix: "terrain_events.vehicles_trapped",
		}),
		...eventAlert({
			id: "drainage_backflow",
			severity: "warning",
			events: backflowEvents,
			message: (count) => `${count} 筆高嚴重度排水回堵壅高通報`,
			refPrefix: "terrain_events.drainage_backflow",
		}),
	];
};

/** Resource and consent alerts are lower severity but keep stable public IDs. */
const resourceAndConsentAlerts = (summary: AggregateSummary): Alert[] =>
	countAlerts(summary, resourceConsentAlertRules);

/**
 * Rule-based alert derivation — no LLM. Future summarisation can read these
 * deterministic results, but it must not overwrite alert triggers or sever refs.
 */
export const deriveAlerts = (
	summary: AggregateSummary,
	overlays: PacketOverlay[],
): Alert[] => [
	...statusAlerts(summary),
	...hazardZoneAlerts(overlays),
	...terrainAlerts(summary),
	...resourceAndConsentAlerts(summary),
];
