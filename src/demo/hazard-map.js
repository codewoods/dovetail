const svgNs = "http://www.w3.org/2000/svg";

/**
 * SVG node construction is centralized so map and legend renderers cannot drift
 * on namespace handling or attribute coercion.
 */
const makeSvg = (tagName, attrs = {}) => {
	const element = document.createElementNS(svgNs, tagName);
	for (const [key, value] of Object.entries(attrs)) {
		element.setAttribute(key, String(value));
	}
	return element;
};

const clearNode = (node) => {
	while (node.firstChild) node.removeChild(node.firstChild);
};

const cssToken = (value) => value.replaceAll("_", "-");

const flattenZonePoints = (hazardZones) =>
	hazardZones.flatMap((zone) =>
		zone.coordinates.map(([lng, lat]) => ({ lng, lat })),
	);

const packetPoints = (packets) =>
	packets.map((packet, index) => ({
		index,
		type: packet.type,
		lat: packet.packet.lat,
		lng: packet.packet.lng,
	}));

const shelterPoints = (shelters) =>
	shelters.map((shelter) => ({
		id: shelter.id,
		name: shelter.name,
		lat: shelter.lat,
		lng: shelter.lng,
		capacity: shelter.capacity,
		supportsVulnerable: shelter.supports_vulnerable,
	}));

/** Bounds are calculated once per render so polygon and packet projection align. */
const coordinateBounds = (points) => {
	const lngs = points.map((point) => point.lng);
	const lats = points.map((point) => point.lat);
	return {
		minLng: Math.min(...lngs),
		maxLng: Math.max(...lngs),
		minLat: Math.min(...lats),
		maxLat: Math.max(...lats),
	};
};

/** The fixed 6-94 viewport margin keeps markers visible at every map edge. */
const projectPoint = (point, bounds) => {
	const lngSpan = Math.max(bounds.maxLng - bounds.minLng, 0.001);
	const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.001);
	const x = 6 + ((point.lng - bounds.minLng) / lngSpan) * 88;
	const y = 94 - ((point.lat - bounds.minLat) / latSpan) * 88;
	return { x, y };
};

/** Build an index lookup once per render; overlay.index, not array order, is the audit key. */
const buildOverlayLookup = (analysis) =>
	new Map(
		(analysis?.overlays ?? []).map((overlay) => [overlay.index, overlay]),
	);

/*
 * Hazard pattern table: one source of truth for hue + texture pairing required
 * by spec §12.1. Keys match HAZARD_ZONES[*].zoneType after cssToken().
 */
const HAZARD_PATTERNS = {
	"river-corridor": { color: "#0072b2", texture: "dot" },
	landslide: { color: "#d55e00", texture: "hatch" },
	default: { color: "#e69f00", texture: "crosshatch" },
};

const patternId = (variant) => `hazard-pattern-${variant}`;

/** Fill the <pattern> tile with the texture lines/dots for one variant. */
const fillPatternTexture = (pattern, color, texture) => {
	if (texture === "dot") {
		pattern.appendChild(
			makeSvg("circle", {
				cx: 2,
				cy: 2,
				r: 0.7,
				fill: color,
				"fill-opacity": 0.85,
			}),
		);
		return;
	}
	if (texture === "hatch") {
		pattern.appendChild(
			makeSvg("path", {
				d: "M-1,5 L5,-1 M-1,1 L1,-1 M3,5 L5,3",
				stroke: color,
				"stroke-width": 0.8,
				"stroke-opacity": 0.9,
				fill: "none",
			}),
		);
		return;
	}
	pattern.appendChild(
		makeSvg("path", {
			d: "M0,0 L4,4 M0,4 L4,0",
			stroke: color,
			"stroke-width": 0.6,
			"stroke-opacity": 0.9,
			fill: "none",
		}),
	);
};

/** Build one <pattern> for a hazard variant: translucent tint + texture. */
const makeHazardPattern = (variant) => {
	const { color, texture } = HAZARD_PATTERNS[variant];
	const pattern = makeSvg("pattern", {
		id: patternId(variant),
		patternUnits: "userSpaceOnUse",
		width: 4,
		height: 4,
	});
	pattern.appendChild(
		makeSvg("rect", {
			width: 4,
			height: 4,
			fill: color,
			"fill-opacity": 0.25,
		}),
	);
	fillPatternTexture(pattern, color, texture);
	return pattern;
};

/** One <defs> per render with every hazard pattern; cheap and isolates state. */
const makeHazardDefs = () => {
	const defs = makeSvg("defs");
	Object.keys(HAZARD_PATTERNS).forEach((variant) => {
		defs.appendChild(makeHazardPattern(variant));
	});
	return defs;
};

/** Map zoneType to its <pattern> variant key while preserving a safe fallback. */
const zoneVariant = (zoneType) => {
	const token = cssToken(zoneType);
	return HAZARD_PATTERNS[token] ? token : "default";
};

/** Hazard source opacity is a UI setting; geometry remains unchanged. */
const renderHazardZones = (hazardZones, bounds, opacity) => {
	const group = makeSvg("g", {
		opacity,
		"data-layer": "hazard-zones",
	});
	hazardZones.forEach((zone) => {
		const points = zone.coordinates
			.map(([lng, lat]) => projectPoint({ lng, lat }, bounds))
			.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`)
			.join(" ");
		const variant = zoneVariant(zone.zoneType);
		const polygon = makeSvg("polygon", {
			points,
			class: `hazard-zone ${cssToken(zone.zoneType)}`,
			fill: `url(#${patternId(variant)})`,
		});
		const title = makeSvg("title");
		title.textContent = zone.label ?? `hazard zone: ${zone.zoneType}`;
		polygon.appendChild(title);
		group.appendChild(polygon);
	});
	return group;
};

/** Shelter squares use public facility points, never private person locations. */
const renderShelterPoint = (shelter, bounds) => {
	const { x, y } = projectPoint(shelter, bounds);
	const group = makeSvg("g", {
		class: `shelter-point${shelter.supportsVulnerable ? " supports-vulnerable" : ""}`,
		transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})`,
	});
	group.appendChild(
		makeSvg("rect", {
			x: -1.8,
			y: -1.8,
			width: 3.6,
			height: 3.6,
			rx: 0.3,
			class: "shelter-shape",
		}),
	);
	if (shelter.supportsVulnerable) {
		group.appendChild(
			makeSvg("path", {
				d: "M-1.1,0 H1.1 M0,-1.1 V1.1",
				class: "shelter-cross",
			}),
		);
	}
	const title = makeSvg("title");
	title.textContent = `shelter ${shelter.id}: ${shelter.name}, capacity ${shelter.capacity}`;
	group.appendChild(title);
	return group;
};

const renderShelters = (shelters, bounds) => {
	const group = makeSvg("g", { "data-layer": "shelters" });
	shelterPoints(shelters).forEach((shelter) => {
		group.appendChild(renderShelterPoint(shelter, bounds));
	});
	return group;
};

/** Marker shape factory: circle for person/resource, triangle for terrain. */
const makeMarkerShape = (pointType, inZone) => {
	if (pointType === "terrain_event") {
		return makeSvg("polygon", {
			points: "0,-2.1 1.9,1.4 -1.9,1.4",
			class: "marker-shape",
		});
	}
	return makeSvg("circle", {
		cx: 0,
		cy: 0,
		r: inZone ? 1.5 : 1.7,
		class: "marker-shape",
	});
};

/*
 * Map points become a <g> so shape, fill, and optional hazard ring stay linked.
 * The redundant ring preserves hazard hits for color-blind users.
 */
const renderPacketPoint = (point, bounds, overlayLookup) => {
	const overlay = overlayLookup.get(point.index);
	const inZone = overlay?.zone.inZone === true;
	const { x, y } = projectPoint(point, bounds);
	const group = makeSvg("g", {
		class: `map-point ${cssToken(point.type)}${inZone ? " in-zone" : ""}`,
		transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})`,
	});
	group.appendChild(makeMarkerShape(point.type, inZone));
	if (inZone) {
		group.appendChild(
			makeSvg("circle", { cx: 0, cy: 0, r: 3, class: "marker-ring" }),
		);
	}
	const title = makeSvg("title");
	title.textContent = inZone
		? `packet ${point.index}: hazard hit`
		: `packet ${point.index}`;
	group.appendChild(title);
	return group;
};

const shelterSummarySuffix = (shelterCount) =>
	shelterCount > 0 ? ` · ${shelterCount} shelters` : "";

const hazardSummaryText = (analysis, shelterCount) =>
	(analysis === null
		? "尚未分析：點位先以白色顯示"
		: `${analysis.overlays.filter((overlay) => overlay.zone.inZone).length}/${analysis.overlays.length} 筆落在 hazard overlay`) +
	shelterSummarySuffix(shelterCount);

const setHazardSummary = (summaryNode, analysis, shelterCount) => {
	summaryNode.textContent = hazardSummaryText(analysis, shelterCount);
};

/**
 * Render local hazard polygons and packet points without adding map dependencies.
 * Inputs are passed in as values so the caller owns state and this module owns SVG.
 */
export const renderHazardMap = ({
	svg,
	summaryNode,
	hazardZones,
	shelters = [],
	packets,
	analysis,
	visible,
	opacity,
}) => {
	clearNode(svg);
	const points = [
		...flattenZonePoints(hazardZones),
		...shelterPoints(shelters),
		...packetPoints(packets),
	];
	if (points.length === 0) return;
	const bounds = coordinateBounds(points);
	const overlayLookup = buildOverlayLookup(analysis);
	const title = makeSvg("title", { id: "hazard-map-title" });
	title.textContent = "Hazard overlay packet map";
	svg.setAttribute("viewBox", "0 0 100 100");
	svg.appendChild(makeHazardDefs());
	svg.appendChild(title);
	if (visible) svg.appendChild(renderHazardZones(hazardZones, bounds, opacity));
	if (shelters.length > 0) svg.appendChild(renderShelters(shelters, bounds));
	packetPoints(packets).forEach((point) => {
		svg.appendChild(renderPacketPoint(point, bounds, overlayLookup));
	});
	setHazardSummary(summaryNode, analysis, shelters.length);
};

/*
 * Legend swatches embed the same patterns and shapes as the map so the legend is
 * a true sample, not a color-only proxy. Each variant draws into a 14x14 mini-SVG.
 */
const LEGEND_RENDERERS = {
	"river-corridor": (svg) => appendLegendZone(svg, "river-corridor"),
	landslide: (svg) => appendLegendZone(svg, "landslide"),
	shelter: (svg) => appendLegendShelter(svg),
	"in-zone": (svg) => appendLegendInZone(svg),
	"terrain-event": (svg) => appendLegendTerrainEvent(svg),
};

const appendLegendZone = (svg, variant) => {
	svg.appendChild(makeHazardPattern(variant));
	svg.appendChild(
		makeSvg("rect", {
			x: 0,
			y: 0,
			width: 14,
			height: 14,
			rx: 2,
			fill: `url(#${patternId(variant)})`,
			stroke: HAZARD_PATTERNS[variant].color,
			"stroke-width": 0.8,
		}),
	);
};

const appendLegendInZone = (svg) => {
	svg.appendChild(
		makeSvg("circle", {
			cx: 7,
			cy: 7,
			r: 5,
			fill: "none",
			stroke: HAZARD_PATTERNS["river-corridor"].color,
			"stroke-width": 0.9,
			"stroke-dasharray": "1.6 1.0",
		}),
	);
	svg.appendChild(
		makeSvg("circle", {
			cx: 7,
			cy: 7,
			r: 2.4,
			fill: "#009e73",
			stroke: "#053d2c",
			"stroke-width": 0.6,
		}),
	);
};

const appendLegendShelter = (svg) => {
	svg.appendChild(
		makeSvg("rect", {
			x: 2.3,
			y: 2.3,
			width: 9.4,
			height: 9.4,
			rx: 1.2,
			fill: "#fff",
			stroke: HAZARD_PATTERNS["river-corridor"].color,
			"stroke-width": 1.1,
		}),
	);
	svg.appendChild(
		makeSvg("path", {
			d: "M4.2,7 H9.8 M7,4.2 V9.8",
			stroke: HAZARD_PATTERNS["river-corridor"].color,
			"stroke-width": 1.1,
			"stroke-linecap": "round",
		}),
	);
};

const appendLegendTerrainEvent = (svg) => {
	svg.appendChild(
		makeSvg("polygon", {
			points: "7,1.5 12.5,12 1.5,12",
			fill: "#cc79a7",
			stroke: "#5a2845",
			"stroke-width": 0.6,
		}),
	);
};

/** Replace each .legend-swatch's body with its variant SVG. Idempotent. */
export const initLegend = (root = document) => {
	const swatches = root.querySelectorAll(".legend-swatch");
	swatches.forEach((swatch) => {
		const variant = Object.keys(LEGEND_RENDERERS).find((name) =>
			swatch.classList.contains(name),
		);
		if (!variant) return;
		const svg = makeSvg("svg", {
			viewBox: "0 0 14 14",
			role: "img",
			class: "legend-swatch-art",
		});
		LEGEND_RENDERERS[variant](svg);
		clearNode(swatch);
		swatch.appendChild(svg);
	});
};
