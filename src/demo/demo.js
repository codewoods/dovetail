import { renderAlerts, renderCentralView, renderQueue } from "/demo-render.js";
import { initLegend, renderHazardMap } from "/hazard-map.js";

const readJsonScript = (id) => {
	const text = document.getElementById(id)?.textContent ?? "{}";
	return JSON.parse(text);
};

const LABELS_BY_LOCALE = readJsonScript("demo-labels");
const HAZARD_ZONES = readJsonScript("demo-hazard-zones");
const SHELTERS = readJsonScript("demo-shelters");
let currentLocale = "zh-Hant-TW";

const labels = () =>
	LABELS_BY_LOCALE[currentLocale] || LABELS_BY_LOCALE["zh-Hant-TW"];
const t = (category, key) => labels()[category]?.[key] || key;
const isEnglishLocale = (locale) => locale.startsWith("en");
const tList = (category, keys) =>
	keys
		.map((key) => t(category, key))
		.join(isEnglishLocale(currentLocale) ? ", " : "、");

const severityRangeText = ([min, max]) =>
	min === max ? `${min}/255` : `${min}-${max}/255`;

const severityBand = (severity) =>
	labels().severity_scale.find(
		({ range }) => severity >= range[0] && severity <= range[1],
	) ?? labels().severity_scale[labels().severity_scale.length - 1];

const severityLabel = (severity) => {
	const band = severityBand(severity);
	return `${band.label} · ${severityRangeText(band.range)}`;
};

const requireValue = (value, message) => {
	if (!value) throw new Error(message);
	return value;
};

const $ = (selector) =>
	requireValue(
		document.querySelector(selector),
		`Missing demo element: ${selector}`,
	);

const fmt = (value) => JSON.stringify(value, null, 2);
const setText = (selector, value) => {
	$(selector).textContent = value;
};

const textElement = (tagName, text, className = "") => {
	const element = document.createElement(tagName);
	if (className) element.className = className;
	element.textContent = text;
	return element;
};

let scenarios = [];
let currentPackets = [];
let lastEncodedFrames = [];
let lastAnalysis = null;
let hazardLayerVisible = true;
let hazardLayerOpacity = 0.72;

const typeByte = (type) =>
	type === "person_report" ? 1 : type === "terrain_event" ? 2 : 3;

const errorMessage = (error) =>
	error instanceof Error ? error.message : String(error);

/** Preserve server error codes so the receiving console can explain failures. */
const responseErrorMessage = async (response, path) => {
	const fallback = `${path} failed with ${response.status}`;
	try {
		const body = await response.json();
		return typeof body?.error === "string"
			? `${fallback}: ${body.error}`
			: fallback;
	} catch (error) {
		return `${fallback}: ${errorMessage(error)}`;
	}
};

const requestBody = (path, payload) => {
	try {
		return JSON.stringify(payload);
	} catch (error) {
		throw new Error(
			`${path} request body encode failed: ${errorMessage(error)}`,
		);
	}
};

const fetchResponse = async (path, init) => {
	try {
		return await fetch(path, init);
	} catch (error) {
		throw new Error(`${path} request failed: ${errorMessage(error)}`);
	}
};

/** POST helpers keep demo failures near the network boundary instead of UI code. */
const postJson = async (path, payload) =>
	fetchJson(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: requestBody(path, payload),
	});

const fetchJson = async (path, init) =>
	responseJson(await fetchResponse(path, init), path);

/** Successful responses still need explicit parse errors for operator feedback. */
const parseResponseJson = async (response, path) => {
	try {
		return await response.json();
	} catch (error) {
		throw new Error(
			`${path} response JSON parse failed: ${errorMessage(error)}`,
		);
	}
};

/** GET/POST callers share response handling so API errors stay visible. */
const responseJson = async (response, path) => {
	if (!response.ok) throw new Error(await responseErrorMessage(response, path));
	return parseResponseJson(response, path);
};

const getJson = async (path) => fetchJson(path);

/** Packet summaries stay compact because they are scanned in a textarea. */
const packetSummary = (packet) => {
	if (packet.type === "person_report")
		return `${t("status", packet.packet.status)} · ${packet.packet.count} 人 · addr=${packet.packet.addr}`;
	if (packet.type === "terrain_event")
		return `${t("terrain_event", packet.packet.event)} · ${severityLabel(packet.packet.severity)} (${packet.packet.severity})`;
	return `${tList("resource", packet.packet.resource)} · ${packet.packet.quantity} 份`;
};

const packetLine = (packet, index) =>
	`[${index}] ${packet.type} mac=${packet.packet.mac} ${packetSummary(packet)}`;

const makeScenarioOption = (scenario) => {
	const option = textElement("option", scenario.label);
	option.value = scenario.id;
	return option;
};

const rerenderForLocale = (event) => {
	currentLocale = event.target.value;
	renderScenarioText();
	if (lastAnalysis) renderReceivingConsole(lastAnalysis);
};

const updateHazardOpacity = (event) => {
	hazardLayerOpacity = Number(event.target.value) / 100;
	setText("#hazard-opacity-value", `${event.target.value}%`);
	renderCurrentHazardMap(lastAnalysis);
};

const updateHazardVisibility = (event) => {
	hazardLayerVisible = event.target.checked;
	renderCurrentHazardMap(lastAnalysis);
};

/** Wire controls once so network/state helpers stay separate from DOM events. */
const wireControls = (scenarioSelect) => {
	scenarioSelect.addEventListener("change", () =>
		loadScenario(scenarioSelect.value),
	);
	$("#btn-encode").addEventListener("click", encodeAll);
	$("#btn-send").addEventListener("click", sendBatch);
	$("#btn-decode").addEventListener("click", decodeAll);
	$("#locale").addEventListener("change", rerenderForLocale);
	$("#hazard-toggle").addEventListener("change", updateHazardVisibility);
	$("#hazard-opacity").addEventListener("input", updateHazardOpacity);
};

/** Scenario options are appended after fetch so startup has one render path. */
const setScenarios = (items) => {
	scenarios = items;
	const scenarioSelect = $("#scenario");
	for (const scenario of scenarios) {
		scenarioSelect.appendChild(makeScenarioOption(scenario));
	}
	wireControls(scenarioSelect);
	loadScenario(scenarios[0].id);
};

/** Bootstrap the offline demo from embedded labels plus served scenario data. */
const init = async () => {
	initLegend();
	setScenarios(await getJson("/api/scenarios"));
};

/** Loading a scenario resets derived views so stale analysis is never displayed. */
const loadScenario = (id) => {
	const scenario = scenarios.find((item) => item.id === id);
	if (!scenario) return;
	currentPackets = scenario.packets;
	renderScenarioDescription(scenario);
	renderScenarioText();
	setText("#hex-output", "");
	setText("#decode-output", "");
	clearNode($("#alerts"));
	clearNode($("#queue-groups"));
	clearNode($("#queue-detail"));
	clearNode($("#view-summary"));
	setText("#analysis-output", "");
	lastAnalysis = null;
	renderCurrentHazardMap(null);
};

const renderScenarioText = () => {
	setText("#scenario-packets", currentPackets.map(packetLine).join("\n"));
	setText("#queue-title", t("queue", "event_queue"));
};

const encodePacket = async (packet, index) => {
	const data = await postJson("/api/codec/encode", { packet });
	return {
		line: `[${index}] type=0x0${typeByte(packet.type)} counter=${data.counter} (${data.size}B) ${data.hex}`,
		frame: { hex: data.hex, counter: data.counter, mac: packet.packet.mac },
	};
};

/** Encode packets through the same API route the public demo documents. */
const encodeAll = async () => {
	lastEncodedFrames = [];
	const encoded = await Promise.all(currentPackets.map(encodePacket));
	lastEncodedFrames = encoded.map(({ frame }) => frame);
	setText("#hex-output", encoded.map(({ line }) => line).join("\n\n"));
};

const decodeFrame = async (frame) => {
	const data = await postJson("/api/codec/decode", frame);
	return fmt(data.packet);
};

/** Decode only frames produced by the current page so counters/MACs stay paired. */
const decodeAll = async () => {
	if (lastEncodedFrames.length === 0) {
		setText("#decode-output", "先按『編碼 → Hex』");
		return;
	}
	const lines = await Promise.all(lastEncodedFrames.map(decodeFrame));
	setText("#decode-output", lines.join("\n---\n"));
};

const clearNode = (node) => {
	while (node.firstChild) node.removeChild(node.firstChild);
};

const localTimeParts = (iso) =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Taipei",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(new Date(iso));

const localTimeValue = (parts, type) =>
	requireValue(
		parts.find((part) => part.type === type)?.value,
		`Missing formatted time part: ${type}`,
	);

/** Render local demo time without changing the UTC datetime used for audit. */
const formatScenarioLocalTime = (iso) => {
	const parts = localTimeParts(iso);
	const year = localTimeValue(parts, "year");
	const month = localTimeValue(parts, "month");
	const day = localTimeValue(parts, "day");
	const hour = localTimeValue(parts, "hour");
	const minute = localTimeValue(parts, "minute");
	return `${year}/${month}/${day} ${hour}:${minute}`;
};

/** Scenario prose is composed from nodes so UTC datetime stays machine-readable. */
const renderScenarioDescription = (scenario) => {
	const node = $("#scenario-desc");
	clearNode(node);
	const time = document.createElement("time");
	time.className = "scenario-time";
	time.dateTime = scenario.occurred_at_utc;
	time.textContent = formatScenarioLocalTime(scenario.occurred_at_utc);
	node.appendChild(textElement("span", scenario.source, "synthetic-badge"));
	node.appendChild(textElement("span", " · ", "scenario-separator"));
	node.appendChild(textElement("span", `${t("queue", "latest_time")} `));
	node.appendChild(time);
	node.appendChild(textElement("span", ` · ${scenario.description}`));
};

const errorNote = (message) => {
	return textElement("p", message, "note");
};

const renderErrorNote = (selector, message) => {
	const node = $(selector);
	clearNode(node);
	node.appendChild(errorNote(message));
};

const receiverErrorMessage = (message) =>
	isEnglishLocale(currentLocale)
		? `Receiver analysis failed: ${message}`
		: `接收端分析失敗：${message}`;

/** Failed sends must not leave dependent receiving panes silently blank. */
const renderSendError = (error) => {
	const message = error instanceof Error ? error.message : String(error);
	const displayMessage = receiverErrorMessage(message);
	lastAnalysis = null;
	setText("#analysis-output", fmt({ error: "send_error", message }));
	renderAlerts($("#alerts"), [
		{ id: "receiver_send_error", severity: "warning", message: displayMessage },
	]);
	renderErrorNote("#queue-groups", displayMessage);
	renderErrorNote("#queue-detail", displayMessage);
	renderErrorNote("#view-summary", displayMessage);
	renderCurrentHazardMap(null);
};

/** Send analysis updates every receiving pane or renders one synchronized error. */
const sendBatch = async () => {
	try {
		const data = await postJson("/api/packets", currentPackets);
		lastAnalysis = data;
		setText("#analysis-output", fmt(data));
		renderReceivingConsole(data);
	} catch (error) {
		renderSendError(error);
	}
};

/** Bind stateful demo inputs to the pure hazard-map SVG renderer. */
const renderCurrentHazardMap = (analysis) =>
	renderHazardMap({
		svg: $("#hazard-map-svg"),
		summaryNode: $("#hazard-summary"),
		hazardZones: HAZARD_ZONES,
		shelters: SHELTERS,
		packets: currentPackets,
		analysis,
		visible: hazardLayerVisible,
		opacity: hazardLayerOpacity,
	});

/** Render all receiving panes from one analysis payload to keep them synchronized. */
const renderReceivingConsole = (data) => {
	renderQueue({
		root: $("#queue-groups"),
		detail: $("#queue-detail"),
		queue: data.event_queue,
		currentLocale,
		t,
		severityLabel,
	});
	renderAlerts($("#alerts"), data.alerts);
	renderCentralView({
		root: $("#view-summary"),
		data,
		currentLocale,
		t,
		severityLabel,
	});
	renderCurrentHazardMap(data);
};

init();
