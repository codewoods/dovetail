/**
 * zh-Hant-TW display labels for the demo's 政府接收端 view summaries.
 *
 * Built-in labels are the tested fallback; complete JSON files under locales/
 * can override them for non-programmer editing. The protocol itself stays
 * English-enum (deterministic codec / OpenAPI / firmware), and the label map is
 * presentation-only so translations cannot change packet semantics.
 */
import enLocaleJson from "../../locales/en-US.json";
import zhTwLocaleJson from "../../locales/zh-Hant-TW.json";
import type {
	PersonFlag,
	PersonStatus,
	ResourceFlag,
	ResourceKind,
	TerrainEvent,
	TerrainFlag,
} from "../packet/types.ts";

export const PERSON_STATUS_LABELS: Record<PersonStatus, string> = {
	unknown: "未確認",
	evacuated_shelter: "撤離至避難收容處所",
	evacuated_relatives: "依親",
	vertical_evacuated: "垂直避難",
	refused: "拒絕撤離",
	rescue_needed: "需要救援",
	self_evacuated_neighbor: "鄰居代報已自行離開",
	address_lost: "原址消失",
};

export const PERSON_FLAG_LABELS: Record<PersonFlag, string> = {
	injured: "受傷",
	special_needs: "避難支援需求",
	long_term_care: "長照個案",
	trapped: "受困",
	non_resident: "非設籍當地",
	foreign_visitor: "外籍訪客",
	migrant_worker: "外籍移工",
	status_changed: "狀態再次變化",
	on_site: "現場通報",
	vertical_evacuation: "垂直避難已確認",
	no_fixed_address: "無固定住所",
	gnss_degraded: "GNSS 訊號異常",
	requires_separated_space: "區隔空間需求",
	consent_acknowledged: "同意被通報",
	consent_refused: "拒絕被通報",
};

export const TERRAIN_EVENT_LABELS: Record<TerrainEvent, string> = {
	road_blocked: "道路阻斷",
	bridge_collapsed: "橋梁崩塌",
	landslide: "土石流",
	flood: "淹水",
	building_collapse: "建物倒塌",
	fire: "火災",
	river_diverted: "河道改道",
	power_outage_area: "區域停電",
	signal_lost: "訊號失聯",
	water_color_change: "水變色",
	mountain_rumbling: "山鳴",
	sudden_animal_behavior: "動物行為異常",
	ground_cracking: "地面龜裂",
	unusual_smell: "異常氣味",
	drainage_backflow: "排水回堵壅高",
};

export const TERRAIN_FLAG_LABELS: Record<TerrainFlag, string> = {
	rapid_rainfall: "短延時強降雨",
	only_exit_control: "道路只出不進",
	vehicles_trapped: "車輛或人員暫時受困",
	backflow_observed: "已觀察到水流回堵或倒灌",
};

export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
	vehicle_transport: "交通工具",
	shelter_space: "收容空間",
	power_generator: "發電設備",
	medical_aid: "醫療協助",
	food_water: "食物飲水",
	communication: "通訊設備",
	fuel: "燃料",
	manpower: "人力協助",
	warmth_supplies: "保暖物資",
	menstrual_supplies: "生理用品",
};

export const RESOURCE_FLAG_LABELS: Record<ResourceFlag, string> = {
	is_request: "請求資源",
	urgent: "緊急",
};

export const QUEUE_LABELS = {
	event_queue: "事件佇列",
	cluster_count: "事件群組",
	packet_count: "封包數",
	latest_time: "最新回報",
	highest_severity: "最高顯示權重",
	queued: "優先檢視",
	watch: "觀察",
} as const;

/**
 * Severity bands per SPEC.md §5.7. Each entry stores the inclusive u8
 * range plus a short passability gloss so the demo can show "嚴重度 230 ·
 * 救災級" without leaking codec keys. severityLabel() is pure so the demo's
 * server-rendered HTML can embed both the table (for tests / debugging) and
 * the client-side classifier through one source of truth.
 */
export interface SeverityBand {
	readonly band: 0 | 1 | 2 | 3;
	readonly label: string;
	readonly range: readonly [number, number];
	readonly passability: string;
}

const BAND_OBSERVE: SeverityBand = {
	band: 0,
	label: "低",
	range: [0, 0],
	passability: "通行無影響, 訊號記錄用",
};
const BAND_CIVILIAN: SeverityBand = {
	band: 1,
	label: "中",
	range: [1, 127],
	passability: "民眾車輛應繞行; 行人 / 4WD 可通行撤離",
};
const BAND_ENGINEERING: SeverityBand = {
	band: 2,
	label: "高",
	range: [128, 191],
	passability: "一般車輛不可; 工程 / 4WD / 救災可進",
};
const BAND_RESCUE: SeverityBand = {
	band: 3,
	label: "最高",
	range: [192, 255],
	passability: "民眾工程不可; 救災通行視現場判斷",
};

export const SEVERITY_BANDS: readonly SeverityBand[] = [
	BAND_OBSERVE,
	BAND_CIVILIAN,
	BAND_ENGINEERING,
	BAND_RESCUE,
];

const severityRangeText = ([min, max]: readonly [number, number]): string =>
	min === max ? `${min}/255` : `${min}-${max}/255`;

const severityBand = (n: number): SeverityBand => {
	if (n <= 0) return BAND_OBSERVE;
	if (n < 128) return BAND_CIVILIAN;
	if (n < 192) return BAND_ENGINEERING;
	return BAND_RESCUE;
};

export const severityLabel = (n: number): string => {
	const band = severityBand(n);
	return `${band.label} · ${severityRangeText(band.range)}`;
};

export const LABELS = {
	status: PERSON_STATUS_LABELS,
	person_flag: PERSON_FLAG_LABELS,
	terrain_event: TERRAIN_EVENT_LABELS,
	terrain_flag: TERRAIN_FLAG_LABELS,
	resource: RESOURCE_KIND_LABELS,
	resource_flag: RESOURCE_FLAG_LABELS,
	queue: QUEUE_LABELS,
	severity_bands: SEVERITY_BANDS.map((b) => b.label),
	severity_scale: SEVERITY_BANDS.map((b) => ({
		label: b.label,
		range: b.range,
		passability: b.passability,
	})),
} as const;

const EN_PERSON_STATUS_LABELS: Record<PersonStatus, string> = {
	unknown: "Unknown",
	evacuated_shelter: "Evacuated to shelter",
	evacuated_relatives: "Evacuated to relatives",
	vertical_evacuated: "Vertical evacuation",
	refused: "Refused evacuation",
	rescue_needed: "Rescue needed",
	self_evacuated_neighbor: "Self-evacuated, neighbor report",
	address_lost: "Original address lost",
};

const EN_PERSON_FLAG_LABELS: Record<PersonFlag, string> = {
	injured: "Injured",
	special_needs: "Evacuation support need",
	long_term_care: "Long-term care case",
	trapped: "Trapped",
	non_resident: "Non-resident",
	foreign_visitor: "Foreign visitor",
	migrant_worker: "Migrant worker",
	status_changed: "Status changed",
	on_site: "On-site report",
	vertical_evacuation: "Vertical evacuation confirmed",
	no_fixed_address: "No fixed address",
	gnss_degraded: "GNSS degraded",
	requires_separated_space: "Separated space needed",
	consent_acknowledged: "Consent acknowledged",
	consent_refused: "Consent refused",
};

const EN_TERRAIN_EVENT_LABELS: Record<TerrainEvent, string> = {
	road_blocked: "Road blocked",
	bridge_collapsed: "Bridge collapsed",
	landslide: "Landslide",
	flood: "Flood",
	building_collapse: "Building collapse",
	fire: "Fire",
	river_diverted: "River diverted",
	power_outage_area: "Area power outage",
	signal_lost: "Signal lost",
	water_color_change: "Water color change",
	mountain_rumbling: "Mountain rumbling",
	sudden_animal_behavior: "Unusual animal behavior",
	ground_cracking: "Ground cracking",
	unusual_smell: "Unusual smell",
	drainage_backflow: "Drainage backflow",
};

const EN_TERRAIN_FLAG_LABELS: Record<TerrainFlag, string> = {
	rapid_rainfall: "Rapid rainfall",
	only_exit_control: "Exit-only road control",
	vehicles_trapped: "Vehicles or people temporarily trapped",
	backflow_observed: "Backflow observed",
};

const EN_RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
	vehicle_transport: "Vehicle transport",
	shelter_space: "Shelter space",
	power_generator: "Power generator",
	medical_aid: "Medical aid",
	food_water: "Food and water",
	communication: "Communication equipment",
	fuel: "Fuel",
	manpower: "Manpower",
	warmth_supplies: "Warmth supplies",
	menstrual_supplies: "Menstrual supplies",
};

const EN_RESOURCE_FLAG_LABELS: Record<ResourceFlag, string> = {
	is_request: "Resource request",
	urgent: "Urgent",
};

const EN_QUEUE_LABELS: Record<keyof typeof QUEUE_LABELS, string> = {
	event_queue: "Event queue",
	cluster_count: "Event clusters",
	packet_count: "Packet count",
	latest_time: "Latest report",
	highest_severity: "Highest display weight",
	queued: "Review first",
	watch: "Watch",
};

const EN_SEVERITY_SCALE = [
	{
		label: "Low",
		range: [0, 0],
		passability: "No passability impact; signal record only",
	},
	{
		label: "Medium",
		range: [1, 127],
		passability: "Civilian vehicles detour; pedestrians / 4WD may evacuate",
	},
	{
		label: "High",
		range: [128, 191],
		passability:
			"Civilian vehicles cannot pass; engineering / 4WD / rescue may enter",
	},
	{
		label: "Critical",
		range: [192, 255],
		passability:
			"Civilian and engineering traffic blocked; rescue access by field judgment",
	},
] as const;

const EN_LABELS = {
	status: EN_PERSON_STATUS_LABELS,
	person_flag: EN_PERSON_FLAG_LABELS,
	terrain_event: EN_TERRAIN_EVENT_LABELS,
	terrain_flag: EN_TERRAIN_FLAG_LABELS,
	resource: EN_RESOURCE_KIND_LABELS,
	resource_flag: EN_RESOURCE_FLAG_LABELS,
	queue: EN_QUEUE_LABELS,
	severity_bands: ["Low", "Medium", "High", "Critical"],
	severity_scale: EN_SEVERITY_SCALE,
} as const;

const REQUIRED_LABEL_SECTIONS = [
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

const bundledLocale = <T extends typeof LABELS | typeof EN_LABELS>(
	fallback: T,
	input: unknown,
): T => (isCompleteLocale(input) ? (input as unknown as T) : fallback);

const isCompleteLocale = (input: unknown): input is Record<string, unknown> =>
	typeof input === "object" &&
	input !== null &&
	!Array.isArray(input) &&
	REQUIRED_LABEL_SECTIONS.every((section) => section in input);

export const LABELS_BY_LOCALE = {
	"zh-Hant-TW": bundledLocale(LABELS, zhTwLocaleJson),
	"zh-TW": bundledLocale(LABELS, zhTwLocaleJson),
	en: bundledLocale(EN_LABELS, enLocaleJson),
	"en-US": bundledLocale(EN_LABELS, enLocaleJson),
} as const;

export type LocaleCode = keyof typeof LABELS_BY_LOCALE;
export type LocaleLabels = (typeof LABELS_BY_LOCALE)[LocaleCode];
