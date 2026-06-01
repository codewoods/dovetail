/**
 * Packet JSON types — canonical form per SPEC.md §7.
 *
 * Shared between the binary codec (encode/decode binary frames) and the
 * analysis component (HTTP API). Keeping the type module pure means the
 * codec and analysis can ship independently as separate component packages.
 */

export type PacketType = "person_report" | "terrain_event" | "resource_report";

export type AeadProfile = "aead-gcm-128" | "aead-ccm-128";

export interface PacketEnvelope {
	received_at: string;
	gateway_id: string;
	aead_profile: AeadProfile;
	chain_mac: string;
}

export type PersonStatus =
	| "unknown"
	| "evacuated_shelter"
	| "evacuated_relatives"
	| "vertical_evacuated"
	| "refused"
	| "rescue_needed"
	| "self_evacuated_neighbor"
	| "address_lost";

export const PERSON_STATUS_TABLE: readonly PersonStatus[] = [
	"unknown",
	"evacuated_shelter",
	"evacuated_relatives",
	"vertical_evacuated",
	"refused",
	"rescue_needed",
	"self_evacuated_neighbor",
	"address_lost",
] as const;

export type PersonFlag =
	| "injured"
	| "special_needs"
	| "long_term_care"
	| "trapped"
	| "non_resident"
	| "foreign_visitor"
	| "migrant_worker"
	| "status_changed"
	| "on_site"
	| "vertical_evacuation"
	| "no_fixed_address"
	| "gnss_degraded"
	| "requires_separated_space"
	| "consent_acknowledged"
	| "consent_refused";

export const PERSON_FLAG_TABLE: readonly PersonFlag[] = [
	"injured",
	"special_needs",
	"long_term_care",
	"trapped",
	"non_resident",
	"foreign_visitor",
	"migrant_worker",
	"status_changed",
	"on_site",
	"vertical_evacuation",
	"no_fixed_address",
	"gnss_degraded",
	"requires_separated_space",
	"consent_acknowledged",
	"consent_refused",
] as const;

export interface PersonReportPacket {
	mac: string;
	village: number;
	ts: number;
	lat: number;
	lng: number;
	alt: number;
	addr: string;
	count: number;
	status: PersonStatus;
	flags: PersonFlag[];
}

export type TerrainEvent =
	| "road_blocked"
	| "bridge_collapsed"
	| "landslide"
	| "flood"
	| "building_collapse"
	| "fire"
	| "river_diverted"
	| "power_outage_area"
	| "signal_lost"
	| "water_color_change"
	| "mountain_rumbling"
	| "sudden_animal_behavior"
	| "ground_cracking"
	| "unusual_smell"
	| "drainage_backflow";

export const TERRAIN_EVENT_TABLE: readonly TerrainEvent[] = [
	"road_blocked",
	"bridge_collapsed",
	"landslide",
	"flood",
	"building_collapse",
	"fire",
	"river_diverted",
	"power_outage_area",
	"signal_lost",
	"water_color_change",
	"mountain_rumbling",
	"sudden_animal_behavior",
	"ground_cracking",
	"unusual_smell",
	"drainage_backflow",
] as const;

export type TerrainFlag =
	| "rapid_rainfall"
	| "only_exit_control"
	| "vehicles_trapped"
	| "backflow_observed";

export const TERRAIN_FLAG_TABLE: readonly TerrainFlag[] = [
	"rapid_rainfall",
	"only_exit_control",
	"vehicles_trapped",
	"backflow_observed",
] as const;

export interface TerrainEventPacket {
	mac: string;
	ts: number;
	lat: number;
	lng: number;
	event: TerrainEvent;
	extent_m: number;
	severity: number;
	flags: TerrainFlag[];
}

export type ResourceKind =
	| "vehicle_transport"
	| "shelter_space"
	| "power_generator"
	| "medical_aid"
	| "food_water"
	| "communication"
	| "fuel"
	| "manpower"
	| "warmth_supplies"
	| "menstrual_supplies";

export const RESOURCE_KIND_TABLE: readonly ResourceKind[] = [
	"vehicle_transport",
	"shelter_space",
	"power_generator",
	"medical_aid",
	"food_water",
	"communication",
	"fuel",
	"manpower",
	"warmth_supplies",
	"menstrual_supplies",
] as const;

export type ResourceFlag = "is_request" | "urgent";

export const RESOURCE_FLAG_TABLE: readonly ResourceFlag[] = [
	"is_request",
	"urgent",
] as const;

export interface ResourceReportPacket {
	mac: string;
	ts: number;
	lat: number;
	lng: number;
	addr: string;
	resource: ResourceKind[];
	quantity: number;
	duration: number;
	flags: ResourceFlag[];
}

export type PacketJson =
	| {
			type: "person_report";
			envelope: PacketEnvelope;
			packet: PersonReportPacket;
	  }
	| {
			type: "terrain_event";
			envelope: PacketEnvelope;
			packet: TerrainEventPacket;
	  }
	| {
			type: "resource_report";
			envelope: PacketEnvelope;
			packet: ResourceReportPacket;
	  };
