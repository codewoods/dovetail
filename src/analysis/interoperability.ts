import {
	type PersonFlag,
	type ResourceKind,
	TERRAIN_EVENT_TABLE,
	type TerrainEvent,
} from "../packet/types.ts";

const PERSON_RECEIVER_TAGS: Partial<Record<PersonFlag, readonly string[]>> = {
	trapped: ["#affected+trapped+ind"],
};

const RESOURCE_RECEIVER_TAGS: Record<ResourceKind, readonly string[]> = {
	vehicle_transport: ["#inneed+transport"],
	shelter_space: ["#inneed+shelter"],
	power_generator: ["#inneed+energy+generator"],
	medical_aid: ["#inneed+health+medical"],
	food_water: ["#inneed+food", "#inneed+water"],
	communication: ["#inneed+comms"],
	fuel: ["#inneed+fuel"],
	manpower: ["#inneed+labor"],
	warmth_supplies: ["#inneed+blanket"],
	menstrual_supplies: ["#inneed+hygiene+menstrual"],
};

const TERRAIN_OSM_TAGS: Partial<Record<TerrainEvent, readonly string[]>> = {
	road_blocked: ["barrier=block"],
	bridge_collapsed: ["bridge:structure=damaged", "barrier:bypass=no"],
	landslide: ["barrier:obstacle_type=landslide_mudslide"],
	flood: ["flood_prone=yes"],
	building_collapse: ["building:damage=collapsed"],
	fire: ["emergency=disaster_response"],
	power_outage_area: ["power=outage"],
};

const PASSABILITY_EVENTS: readonly TerrainEvent[] = [
	"road_blocked",
	"bridge_collapsed",
	"landslide",
	"flood",
	"building_collapse",
];

export const receiverTagsForPersonFlag = (flag: string): string | undefined =>
	tagCell(PERSON_RECEIVER_TAGS[flag as PersonFlag] ?? []);

export const receiverTagsForResource = (
	resource: ResourceKind,
	urgent: boolean,
): string | undefined =>
	tagCell(
		RESOURCE_RECEIVER_TAGS[resource].map((tag) => urgentTag(tag, urgent)),
	);

export const osmTagsForQueueKind = (
	kind: string,
	severity: number,
): string | undefined => {
	const event = terrainEventFromQueueKind(kind);
	return event === undefined
		? undefined
		: osmTagsForTerrainEvent(event, severity);
};

/**
 * Emit mapper-review hints, not authoritative OSM edits. Static base tags name
 * the observed terrain event, while passability tags expose the local 4-band
 * severity scale only for events that can reasonably affect movement.
 */
export const osmTagsForTerrainEvent = (
	event: TerrainEvent,
	severity: number,
): string | undefined => {
	const base = TERRAIN_OSM_TAGS[event] ?? [];
	if (base.length === 0) return undefined;
	const passability = PASSABILITY_EVENTS.includes(event)
		? passabilityTags(severity)
		: [];
	return tagCell([...base, ...passability]);
};

const urgentTag = (tag: string, urgent: boolean): string =>
	urgent ? `${tag}+urgent` : tag;

const isTerrainEvent = (value: string): value is TerrainEvent =>
	(TERRAIN_EVENT_TABLE as readonly string[]).includes(value);

const terrainEventFromQueueKind = (kind: string): TerrainEvent | undefined => {
	if (!kind.startsWith("terrain_event:")) return undefined;
	const event = kind.slice("terrain_event:".length);
	return isTerrainEvent(event) ? event : undefined;
};

const passabilityTags = (severity: number): readonly string[] => {
	if (severity === 0) return ["practicability=yes"];
	if (severity < 128) return ["practicability=destination"];
	if (severity < 192) return ["practicability=no"];
	return ["practicability=no", "access=emergency"];
};

const tagCell = (tags: readonly string[]): string | undefined =>
	tags.length === 0 ? undefined : tags.join(";");
