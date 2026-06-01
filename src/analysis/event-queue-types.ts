export type QueueStatus = "queued" | "watch";
export type ReceiptState = "received" | "queued" | "review_hint";
export type TimeConfidence = "reported_time" | "stale_report_time";

export interface EventCluster {
	readonly id: string;
	readonly kind: string;
	readonly status: QueueStatus;
	readonly count: number;
	readonly maxSeverity: number;
	readonly latestTs: number;
	readonly confidence: number;
	readonly receiptState: ReceiptState;
	readonly timeConfidence: TimeConfidence;
	readonly boundaryUncertain: boolean;
	readonly centroid: { readonly lat: number; readonly lng: number };
	readonly packetIndexes: readonly number[];
}

export interface EventQueueGroup {
	readonly adminAreaKey: string;
	readonly label: string;
	readonly totalPackets: number;
	readonly highestSeverity: number;
	readonly latestTs: number;
	readonly clusters: readonly EventCluster[];
}

export interface EventQueue {
	readonly totalPackets: number;
	readonly groups: readonly EventQueueGroup[];
	readonly hints: readonly QueueHint[];
}

export interface QueueHint {
	readonly type:
		| "same_kind_nearby_duplicate"
		| "mutually_exclusive_person_status"
		| "gateway_burst_resend"
		| "administrative_boundary_uncertain";
	readonly adminAreaKey: string;
	readonly clusterIds: readonly string[];
	readonly message: string;
}

export interface QueueItem {
	readonly index: number;
	readonly adminAreaKey: string;
	readonly label: string;
	readonly kind: string;
	readonly lat: number;
	readonly lng: number;
	readonly ts: number;
	readonly severity: number;
	readonly confidence: number;
	readonly boundaryUncertain: boolean;
}
