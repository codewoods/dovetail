import type { EventQueueGroup, QueueHint } from "./event-queue-types.ts";

/**
 * Hints are review prompts, not decisions. They tell an operator "these reports
 * may need human reconciliation" while preserving all packet indexes for audit.
 */
export const deriveHints = (groups: readonly EventQueueGroup[]): QueueHint[] =>
	groups.flatMap((group) => [
		...group.clusters
			.filter((cluster) => cluster.count > 1)
			.map((cluster) => ({
				type: "same_kind_nearby_duplicate" as const,
				adminAreaKey: group.adminAreaKey,
				clusterIds: [cluster.id],
				message:
					"Nearby same-kind reports were clustered; verify whether they describe one incident.",
			})),
		...conflictHints(group),
		...boundaryHints(group),
	]);

const conflictHints = (group: EventQueueGroup): QueueHint[] => {
	const personClusters = group.clusters.filter((cluster) =>
		cluster.kind.startsWith("person_report:"),
	);
	const rescue = personClusters.filter(
		(cluster) =>
			cluster.kind === "person_report:rescue_needed" ||
			cluster.kind === "person_report:address_lost",
	);
	const resolved = personClusters.filter((cluster) =>
		cluster.kind.startsWith("person_report:evacuated"),
	);
	if (rescue.length === 0 || resolved.length === 0) return [];
	return [
		{
			type: "mutually_exclusive_person_status",
			adminAreaKey: group.adminAreaKey,
			clusterIds: [...rescue, ...resolved].map((cluster) => cluster.id),
			message:
				"Nearby person reports contain both unresolved and evacuated states; human reconciliation required.",
		},
	];
};

const boundaryHints = (group: EventQueueGroup): QueueHint[] => {
	const uncertain = group.clusters.filter(
		(cluster) => cluster.boundaryUncertain,
	);
	if (uncertain.length === 0) return [];
	return [
		{
			type: "administrative_boundary_uncertain",
			adminAreaKey: group.adminAreaKey,
			clusterIds: uncertain.map((cluster) => cluster.id),
			message:
				"One or more clusters are near a demo administrative boundary; confirm jurisdiction before follow-up.",
		},
	];
};
